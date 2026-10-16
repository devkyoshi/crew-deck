import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminDb, caller, createOrg, ensureUser, makeApp, signInAs, tenantIds, uniqueEmail } from './helpers.js';
import { sweepSla } from '../src/work/notify-jobs.js';

const t = makeApp();
const call = caller(t.app);
afterAll(() => t.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

let ids: Awaited<ReturnType<typeof tenantIds>>;
const u: Record<string, { id: string; email: string }> = {};
const c: Record<string, string> = {};
const send = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: Json) =>
  call({ method, url, slug: 'acme', cookie, payload });

beforeAll(async () => {
  ids = await tenantIds();
  for (const [name, role] of [
    ['owner', 'owner'],
    ['agent', 'member'],
    ['requester', 'member'],
  ] as const) {
    u[name] = await ensureUser({ orgId: ids.acme, email: uniqueEmail(`sd-${name}`), role });
    c[name] = await signInAs(t.app, 'acme', u[name]);
  }
});

const key = () => `D${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

/** A service desk run by the owner and the agent. The requester is only a workspace member. */
async function desk(boardType: 'service' | 'kanban' = 'service') {
  const res = await send('POST', '/spaces', c.owner!, {
    key: key(),
    name: 'QA desk',
    boardType,
    members: [{ type: 'user', id: u.agent!.id, role: 'member' }],
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Json;
}
const raise = (sp: Json, cookie: string, body: Json = {}) =>
  send('POST', `/spaces/${sp.id}/items`, cookie, { type: 'ticket', title: 'Login is broken', priority: 'high', ...body });
const get = async (id: string) => (await send('GET', `/items/${id}`, c.owner!)).json() as Json;

describe('service desks', () => {
  it('start with ticket columns and report the board type', async () => {
    const sp = await desk();
    expect(sp.boardType).toBe('service');
    const statuses = (await send('GET', `/spaces/${sp.id}/statuses`, c.owner!)).json().items as Json[];
    expect(statuses.map((s) => s.name)).toEqual(['Open', 'In Progress', 'Waiting', 'Resolved']);
  });

  it('let any workspace member raise a ticket, with deadlines from the targets', async () => {
    const sp = await desk();
    const res = await raise(sp, c.requester!);
    expect(res.statusCode, res.body).toBe(200);
    const ticket = res.json() as Json;
    expect(ticket).toMatchObject({ type: 'ticket', reporter: { id: u.requester!.id } });
    expect(ticket.sla.response.state).toBe('ok');
    expect(new Date(ticket.sla.response.dueAt).getTime()).toBeGreaterThan(Date.now());
    // The resolve target is later than the response target for the same priority.
    expect(new Date(ticket.sla.resolve.dueAt).getTime()).toBeGreaterThan(new Date(ticket.sla.response.dueAt).getTime());
  });

  it('keep ordinary work for people with member rights, and tickets for service desks', async () => {
    const sp = await desk();
    const task = await send('POST', `/spaces/${sp.id}/items`, c.requester!, { type: 'task', title: 'Not allowed' });
    expect(task.statusCode).toBe(403);
    const board = await desk('kanban');
    const wrong = await raise(board, c.owner!);
    expect(wrong.statusCode).toBe(422);
  });

  it('do not let the requester edit the ticket, but they can follow up on it', async () => {
    const sp = await desk();
    const ticket = (await raise(sp, c.requester!)).json() as Json;
    const edit = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${ticket.id}`,
      headers: { host: 'acme.localhost:3000', 'if-match': ticket.updatedAt },
      cookies: { cd_session: c.requester! },
      payload: { title: 'Mine now' },
    });
    expect(edit.statusCode).toBe(403);
    const comment = await send('POST', `/items/${ticket.id}/comments`, c.requester!, {
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Still broken' }] }] },
    });
    expect(comment.statusCode, comment.body).toBe(200);
    // The person who asked following up is not an answer from the team.
    expect((await get(ticket.id)).sla.response.state).toBe('ok');
  });

  it('stop the response clock when the team first answers', async () => {
    const sp = await desk();
    const ticket = (await raise(sp, c.requester!)).json() as Json;
    const reply = await send('POST', `/items/${ticket.id}/comments`, c.agent!, {
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'On it' }] }] },
    });
    expect(reply.statusCode, reply.body).toBe(200);
    const after = await get(ticket.id);
    expect(after.sla.response.state).toBe('met');
    expect(after.sla.response.doneAt).not.toBeNull();
    expect(after.sla.resolve.state).toBe('ok');
  });

  it('restart the deadlines from when the ticket was raised if its priority changes', async () => {
    const sp = await desk();
    const ticket = (await raise(sp, c.requester!, { priority: 'low' })).json() as Json;
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${ticket.id}`,
      headers: { host: 'acme.localhost:3000', 'if-match': ticket.updatedAt },
      cookies: { cd_session: c.agent! },
      payload: { priority: 'highest' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const after = res.json() as Json;
    expect(new Date(after.sla.resolve.dueAt).getTime()).toBeLessThan(new Date(ticket.sla.resolve.dueAt).getTime());
  });

  it('keep a ticket a ticket', async () => {
    const sp = await desk();
    const ticket = (await raise(sp, c.requester!)).json() as Json;
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/items/${ticket.id}`,
      headers: { host: 'acme.localhost:3000', 'if-match': ticket.updatedAt },
      cookies: { cd_session: c.agent! },
      payload: { type: 'task' },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('response targets', () => {
  const policy = (hours: number) => ({
    businessHours: false,
    targets: Object.fromEntries(
      ['highest', 'high', 'medium', 'low', 'lowest'].map((p) => [p, { responseMinutes: hours * 60, resolveMinutes: hours * 120 }]),
    ),
  });

  it('are read by anyone and changed only by the desk admins', async () => {
    const sp = await desk();
    const read = (await send('GET', `/spaces/${sp.id}/sla`, c.requester!)).json() as Json;
    expect(read).toMatchObject({ enabled: true, permissions: { manage: false } });
    expect((await send('PUT', `/spaces/${sp.id}/sla`, c.agent!, policy(2))).statusCode).toBe(403);
    const ok = await send('PUT', `/spaces/${sp.id}/sla`, c.owner!, policy(2));
    expect(ok.statusCode, ok.body).toBe(200);
    const ticket = (await raise(sp, c.requester!)).json() as Json;
    const gap = new Date(ticket.sla.response.dueAt).getTime() - new Date(ticket.createdAt).getTime();
    expect(Math.round(gap / 3_600_000)).toBe(2);
  });

  it('reject nonsense and only exist for service desks', async () => {
    const sp = await desk();
    const bad = await send('PUT', `/spaces/${sp.id}/sla`, c.owner!, { ...policy(1), targets: {} });
    expect(bad.statusCode).toBe(400);
    const board = await desk('kanban');
    expect((await send('PUT', `/spaces/${board.id}/sla`, c.owner!, policy(1))).statusCode).toBe(409);
  });
});

describe('missed deadlines', () => {
  it('can be filtered, and the person answering the ticket is told once', async () => {
    const sp = await desk();
    const ticket = (await raise(sp, c.requester!, { assigneeId: u.agent!.id })).json() as Json;
    const tenant = t.db.tenant(ids.acme);
    await tenant.workItems.updateOne({ id: ticket.id }, { slaResolveDueAt: new Date(Date.now() - 60_000) });

    const late = (await send('GET', `/spaces/${sp.id}/list?sla=breached`, c.owner!)).json() as Json;
    expect(late.items.map((i: Json) => i.id)).toContain(ticket.id);
    expect(late.items.find((i: Json) => i.id === ticket.id).sla.resolve.state).toBe('breached');

    const other = (await raise(sp, c.requester!)).json() as Json;
    const clean = (await send('GET', `/spaces/${sp.id}/list?sla=breached`, c.owner!)).json() as Json;
    expect(clean.items.map((i: Json) => i.id)).not.toContain(other.id);

    await sweepSla(t.db);
    await sweepSla(t.db); // running again changes nothing
    const told = await tenant.notifications.find({ itemId: ticket.id, type: 'sla_breached' });
    expect(told).toHaveLength(1);
    expect(told[0]!.userId).toBe(u.agent!.id);
  });
});

describe('plans', () => {
  it('keep service desks off the free plan', async () => {
    const { org, slug, owner } = await createOrg('desk-free');
    const db = adminDb();
    try {
      await db.db.global.organizations.updateOne({ id: org.id }, { planKey: 'free' });
    } finally {
      await db.close();
    }
    const cookie = await signInAs(t.app, slug, owner);
    const res = await call({
      method: 'POST',
      url: '/spaces',
      slug,
      cookie,
      payload: { key: key(), name: 'Desk', boardType: 'service' },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe('feature_locked');
  });
});
