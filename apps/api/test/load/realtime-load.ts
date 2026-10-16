/**
 * Load test for the realtime gateway: thousands of sockets across several workspaces, a steady stream
 * of messages, and checks that every message reaches everyone in its channel exactly once, never anyone
 * in another workspace, and fast enough.
 *
 *   pnpm --filter @crew-deck/api load:realtime
 *   TENANTS=5 USERS=600 RATE=8 SECONDS=30 pnpm --filter @crew-deck/api load:realtime
 *
 * It starts its own gateway process against a throwaway database (crewdeck_load) and removes everything
 * it made. MongoDB and Redis must be running, as for the other tests. Results go to stdout as a table
 * and as JSON on the last line; the exit code is 1 when a target is missed.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { io as connect, type Socket } from 'socket.io-client';
import { SOCKET_PATH } from '@crew-deck/shared';
import { createDb } from '../../src/db/client.js';
import { migrate } from '../../src/db/migrate.js';
import { loadConfig } from '../../src/config.js';
import { SessionStore } from '../../src/auth/sessions.js';
import { createRedis } from '../../src/lib/redis.js';

const num = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
const TENANTS = num('TENANTS', 4);
const USERS = num('USERS', 250); // per tenant
const SENDERS = num('SENDERS', 3); // people sending in each tenant
const RATE = num('RATE', 5); // messages per second, per tenant
const SECONDS = num('SECONDS', 20);
const RAMP = num('RAMP', 150); // new connections per second
const PORT = num('PORT_LOAD', 4199);
const GATEWAYS = num('GATEWAYS', 1); // gateway processes; sockets are spread across them
const DB_NAME = 'crewdeck_load';

// The agreed targets (docs/messaging/LOAD-TEST.md).
const TARGET = {
  connectFailures: 0,
  lost: 0,
  duplicates: 0,
  leaks: 0,
  p95Ms: num('TARGET_P95', 750),
  p99Ms: num('TARGET_P99', 2000),
  ackP95Ms: num('TARGET_ACK_P95', 500),
};

const here = path.dirname(fileURLToPath(import.meta.url));
const realtimeDir = path.resolve(here, '../../../realtime');

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForGateway(child: ChildProcess, port: number) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error('the gateway exited while starting');
    try {
      const res = await fetch(`http://127.0.0.1:${port}/realtime/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('the gateway did not start in time');
}

interface Tenant {
  idx: number;
  orgId: string;
  slug: string;
  people: { userId: string; sid: string }[];
  channelId: string;
}

async function main() {
  const config = loadConfig({ ...process.env, MONGODB_DB: DB_NAME, LOG_LEVEL: 'silent' });
  await migrate(config.MONGODB_URI, DB_NAME);
  const { db, close } = createDb(config.MONGODB_URI, DB_NAME);
  const redis = createRedis(config.REDIS_URL);
  const sessions = new SessionStore(redis, 3600);

  console.log(`Setting up ${TENANTS} workspaces with ${USERS} people each…`);
  const tenants: Tenant[] = [];
  for (let i = 0; i < TENANTS; i++) {
    const slug = `load${i}-${Math.random().toString(36).slice(2, 6)}`;
    const org = await db.global.organizations.insert({ name: slug, slug, domain: `${slug}.test` });
    const t = db.global.forOrg(org.id);
    const people: Tenant['people'] = [];
    for (let u = 0; u < USERS; u++) {
      const user = await db.global.users.insert({
        email: `u${u}@${slug}.test`,
        name: `Load ${u}`,
        status: 'active',
        passwordHash: 'x',
      });
      await t.memberships.insert({ userId: user.id, orgRole: u === 0 ? 'owner' : 'member' });
      people.push({ userId: user.id, sid: await sessions.create(org.id, user.id) });
    }
    // The workspace's #general, with everyone in it, as it is after people have opened Messages once.
    const general = await t.channels.insert({
      type: 'public',
      name: 'general',
      slug: 'general',
      topic: null,
      description: null,
      isAnnouncement: false,
      createdBy: people[0]!.userId,
    });
    await t.channelMembers.insert(
      people.map((p, n) => ({ channelId: general.id, userId: p.userId, role: n === 0 ? ('owner' as const) : ('member' as const) })),
    );
    await t.memberships.updateMany({}, { messagingInitAt: new Date() });
    tenants.push({ idx: i, orgId: org.id, slug, people, channelId: general.id });
  }

  console.log('Starting the gateway…');
  const gateways = Array.from({ length: GATEWAYS }, (_, i) =>
    spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: realtimeDir,
      env: { ...process.env, MONGODB_DB: DB_NAME, REALTIME_PORT: String(PORT + i), LOG_LEVEL: 'silent' },
      stdio: ['ignore', 'inherit', 'inherit'],
    }),
  );
  const metrics = async () => {
    const all = await Promise.all(
      gateways.map(async (_, i) => (await fetch(`http://127.0.0.1:${PORT + i}/realtime/metrics`)).json() as Promise<Record<string, number>>),
    );
    const sum = { sockets: 0, rooms: 0, rssMb: 0, heapMb: 0, uptimeSeconds: 0, cpuMs: 0 };
    for (const m of all) {
      sum.sockets += m.sockets ?? 0;
      sum.rooms += m.rooms ?? 0;
      sum.rssMb += m.rssMb ?? 0;
      sum.heapMb += m.heapMb ?? 0;
      sum.uptimeSeconds = Math.max(sum.uptimeSeconds, m.uptimeSeconds ?? 0);
      sum.cpuMs += m.cpuMs ?? 0;
    }
    return sum;
  };

  const sockets: { s: Socket; tenant: Tenant }[] = [];
  const connectMs: number[] = [];
  let connectFailures = 0;
  const latencies: number[] = [];
  const ackMs: number[] = [];
  const seen = new Map<string, number>(); // `${socketIndex}|${messageKey}` -> times received
  let leaks = 0;
  let sendFailures = 0;
  const failureCodes = new Map<string, number>();
  let sent = 0;
  const sentPerTenant = new Array(TENANTS).fill(0) as number[];

  try {
    for (let i = 0; i < gateways.length; i++) await waitForGateway(gateways[i]!, PORT + i);

    console.log(`Connecting ${TENANTS * USERS} sockets (${RAMP}/s)…`);
    const total = TENANTS * USERS;
    const started = performance.now();
    let index = 0;
    await new Promise<void>((resolve) => {
      let pending = 0;
      let launched = 0;
      const launch = () => {
        while (launched < total && pending < RAMP) {
          const tenant = tenants[launched % TENANTS]!;
          const person = tenant.people[Math.floor(launched / TENANTS)]!;
          const at = performance.now();
          const mine = index++;
          const s = connect(`http://127.0.0.1:${PORT + (launched % GATEWAYS)}`, {
            path: SOCKET_PATH,
            transports: ['websocket'],
            forceNew: true,
            reconnection: false,
            extraHeaders: { 'x-forwarded-host': `${tenant.slug}.localhost:3000`, cookie: `cd_session=${person.sid}` },
          });
          sockets.push({ s, tenant });
          pending++;
          launched++;
          let done = false;
          const finish = (ok: boolean) => {
            if (done) return;
            done = true;
            pending--;
            if (ok) connectMs.push(performance.now() - at);
            else connectFailures++;
            if (launched >= total && pending === 0) resolve();
          };
          s.on('connect', () => finish(true));
          s.on('connect_error', () => finish(false));
          s.on('message:new', (m: { bodyText?: string }) => {
            const text = m.bodyText ?? '';
            if (!text.startsWith('LT|')) return;
            const [, tIdx, n, ts] = text.split('|') as [string, string, string, string];
            if (Number(tIdx) !== tenant.idx) {
              leaks++;
              return;
            }
            latencies.push(Date.now() - Number(ts));
            const key = `${mine}|${tIdx}|${n}`;
            seen.set(key, (seen.get(key) ?? 0) + 1);
          });
        }
      };
      const timer = setInterval(() => {
        launch();
        if (launched >= total) clearInterval(timer);
      }, 1000 / Math.max(1, RAMP / 10));
      launch();
    });
    const rampSeconds = (performance.now() - started) / 1000;
    const stats0 = await metrics();
    console.log(`Connected ${sockets.filter((x) => x.s.connected).length}/${total} in ${rampSeconds.toFixed(1)}s. Gateway: ${JSON.stringify(stats0)}`);

    console.log(`Sending ${RATE}/s per workspace for ${SECONDS}s…`);
    const cpuBefore = { gateway: (stats0 as { cpuMs: number }).cpuMs, client: process.cpuUsage(), at: Date.now() };
    const senders = tenants.map((t) => sockets.filter((x) => x.tenant === t && x.s.connected).slice(0, SENDERS));
    const timers: NodeJS.Timeout[] = [];
    let counter = 0;
    for (const t of tenants) {
      let turn = 0;
      timers.push(
        setInterval(() => {
          const who = senders[t.idx]![turn++ % Math.max(1, senders[t.idx]!.length)];
          if (!who) return;
          const n = ++counter;
          const at = Date.now();
          sentPerTenant[t.idx]!++;
          sent++;
          const t0 = performance.now();
          who.s.emit(
            'message:send',
            {
              channelId: t.channelId,
              clientMsgId: `load-${t.idx}-${n}-${at}`,
              body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `LT|${t.idx}|${n}|${at}` }] }] },
            },
            (ack: { ok: boolean; code?: string }) => {
              if (ack?.ok) ackMs.push(performance.now() - t0);
              else {
                sendFailures++;
                failureCodes.set(ack?.code ?? 'NO_ACK', (failureCodes.get(ack?.code ?? 'NO_ACK') ?? 0) + 1);
              }
            },
          );
        }, 1000 / RATE),
      );
    }
    await sleep(SECONDS * 1000);
    for (const t of timers) clearInterval(t);
    await sleep(4000); // let the last messages arrive
    const statsEnd = await metrics();
    const wall = Date.now() - cpuBefore.at - 4000;
    const clientCpu = process.cpuUsage(cpuBefore.client);
    const cpu = {
      gatewayCoresTotal: Number((((statsEnd as { cpuMs: number }).cpuMs - cpuBefore.gateway) / (wall + 4000)).toFixed(2)),
      gatewayCoresPerProcess: Number((((statsEnd as { cpuMs: number }).cpuMs - cpuBefore.gateway) / (wall + 4000) / GATEWAYS).toFixed(2)),
      clientCores: Number((((clientCpu.user + clientCpu.system) / 1000) / (wall + 4000)).toFixed(2)),
    };

    // Everyone who stayed connected should have every message of their own workspace exactly once.
    let expected = 0;
    let lost = 0;
    let duplicates = 0;
    const live = new Map<number, number>();
    sockets.forEach((x, i) => {
      if (x.s.connected) live.set(i, x.tenant.idx);
    });
    // Message numbers per tenant are not contiguous (a shared counter), so count what each socket saw.
    for (const [i, tIdx] of live) {
      const want = sentPerTenant[tIdx]!;
      expected += want;
      let got = 0;
      for (const [key, times] of seen) {
        if (!key.startsWith(`${i}|`)) continue;
        got++;
        if (times > 1) duplicates += times - 1;
      }
      lost += Math.max(0, want - got);
    }

    const result = {
      scale: { gateways: GATEWAYS, tenants: TENANTS, usersPerTenant: USERS, sockets: sockets.length, ratePerTenant: RATE, seconds: SECONDS },
      connect: { failures: connectFailures, p50Ms: Math.round(pct(connectMs, 50)), p95Ms: Math.round(pct(connectMs, 95)), p99Ms: Math.round(pct(connectMs, 99)) },
      send: { sent, acked: ackMs.length, failed: sendFailures, failureCodes: Object.fromEntries(failureCodes), ackP50Ms: Math.round(pct(ackMs, 50)), ackP95Ms: Math.round(pct(ackMs, 95)) },
      delivery: {
        expected,
        received: latencies.length,
        lost,
        duplicates,
        leaksToOtherWorkspaces: leaks,
        p50Ms: Math.round(pct(latencies, 50)),
        p95Ms: Math.round(pct(latencies, 95)),
        p99Ms: Math.round(pct(latencies, 99)),
        maxMs: Math.round(latencies.reduce((m, x) => Math.max(m, x), 0)),
      },
      cpuDuringLoad: cpu,
      gateway: { afterConnect: stats0, afterLoad: statsEnd },
      clientRssMb: Math.round(process.memoryUsage().rss / 1048576),
    };
    console.log(JSON.stringify(result, null, 2));

    const missed: string[] = [];
    if (result.connect.failures > TARGET.connectFailures) missed.push(`connect failures ${result.connect.failures}`);
    if (result.send.failed > 0) missed.push(`send failures ${result.send.failed}`);
    if (result.delivery.lost > TARGET.lost) missed.push(`lost deliveries ${result.delivery.lost}`);
    if (result.delivery.duplicates > TARGET.duplicates) missed.push(`duplicates ${result.delivery.duplicates}`);
    if (result.delivery.leaksToOtherWorkspaces > TARGET.leaks) missed.push(`cross-workspace leaks ${result.delivery.leaksToOtherWorkspaces}`);
    if (result.delivery.p95Ms > TARGET.p95Ms) missed.push(`delivery p95 ${result.delivery.p95Ms}ms > ${TARGET.p95Ms}ms`);
    if (result.delivery.p99Ms > TARGET.p99Ms) missed.push(`delivery p99 ${result.delivery.p99Ms}ms > ${TARGET.p99Ms}ms`);
    if (result.send.ackP95Ms > TARGET.ackP95Ms) missed.push(`ack p95 ${result.send.ackP95Ms}ms > ${TARGET.ackP95Ms}ms`);
    if (missed.length) {
      console.log(`\nTARGETS MISSED:\n - ${missed.join('\n - ')}`);
      process.exitCode = 1;
    } else {
      console.log('\nAll targets met.');
    }
  } finally {
    for (const x of sockets) x.s.disconnect();
    for (const g of gateways) g.kill();
    await sleep(500);
    // Remove what this run made: the database, and the session and presence keys in Redis.
    for (const t of tenants) {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', `org:${t.orgId}:*`, 'COUNT', 500);
        cursor = next;
        if (keys.length) await redis.del(...keys);
      } while (cursor !== '0');
    }
    await close();
    const { MongoClient } = await import('mongodb');
    const mongo = new MongoClient(config.MONGODB_URI);
    await mongo.db(DB_NAME).dropDatabase();
    await mongo.close();
    redis.disconnect();
  }
}

await main();
