import { createServer } from 'node:http';
import {
  Presence,
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

const http = createServer((req, res) => {
  if (req.url === '/realtime/health') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    return;
  }
  // Socket.IO answers its own path; anything else is not ours.
  if (!req.url?.startsWith('/realtime/socket.io')) res.writeHead(404).end();
});

const gateway = createGateway(http, {
  db,
  config,
  redis,
  sessions: new SessionStore(redis, config.SESSION_TTL_SECONDS),
  messaging: { db, events: new RedisEventSink(redis) },
  presence: new Presence(redis),
  limiter: new RateLimiter(redis),
  log: { info: (m) => console.log(m), error: (m, e) => console.error(m, e) },
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await gateway.close();
    http.close();
    redis.disconnect();
    await close();
    process.exit(0);
  });
}

http.listen(port, () => console.log(`realtime gateway listening on :${port}`));
