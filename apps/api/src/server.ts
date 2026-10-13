import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { createRedis } from './lib/redis.js';

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
const app = buildApp({ db, redis, config });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    redis.disconnect();
    await close();
    process.exit(0);
  });
}

await app.listen({ port: config.API_PORT, host: config.API_HOST });
