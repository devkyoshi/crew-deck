import { createServer } from 'node:http';
import {
  Presence,
  createLinkPreviewEnqueuer,
  createStorage,
  RateLimiter,
  RedisEventSink,
  SessionStore,
  createDb,
  createRedis,
  loadConfig,
} from '@crew-deck/api/realtime';
import { createGateway } from './gateway.js';

const config = loadConfig();
const port = Number(process.env.REALTIME_PORT ?? 4100);
const { db, close } = createDb(config.MONGODB_URI, config.MONGODB_DB);
const redis = createRedis(config.REDIS_URL);
const previews = createLinkPreviewEnqueuer(redis);
const limiter = new RateLimiter(redis);
const presence = new Presence(redis);

const http = createServer((req, res) => {
  if (req.url === '/realtime/health') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    return;
  }
  // Connection counts and memory, for the load test and for operators on the machine itself: only from
  // the loopback address and never through the proxy (which adds forwarding headers).
  if (req.url === '/realtime/metrics') {
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
    if (!local || req.headers['x-forwarded-for'] || req.headers['x-forwarded-host']) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(gateway.stats()));
    return;
  }
  // Socket.IO answers its own path; anything else is not ours.
  if (!req.url?.startsWith('/realtime/socket.io')) res.writeHead(404).end();
});

const gateway: ReturnType<typeof createGateway> = createGateway(http, {
  db,
  config,
  redis,
  sessions: new SessionStore(redis, config.SESSION_TTL_SECONDS),
  messaging: {
    db,
    events: new RedisEventSink(redis),
    limiter,
    presence,
    storage: createStorage(config),
    enqueueLinkPreviews: previews.enqueue,
  },
  presence,
  limiter,
  log: { info: (m) => console.log(m), error: (m, e) => console.error(m, e) },
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await gateway.close();
    await previews.close();
    http.close();
    redis.disconnect();
    await close();
    process.exit(0);
  });
}

http.listen(port, () => console.log(`realtime gateway listening on :${port}`));
