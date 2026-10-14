import { buildApp } from './app.js';
import { emailEnabled, loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { startAutoCloseJobs } from './checkin/jobs.js';
import { createInviteEmailQueue, startInviteEmailWorker } from './email/queue.js';
import { createBrevoSender, createLogSender } from './email/sender.js';
import { createRedis } from './lib/redis.js';
import { startTrialExpiry } from './plans/jobs.js';
import { startRebalanceJobs } from './work/jobs.js';

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
const queue = createInviteEmailQueue(redis);
const sender = emailEnabled(config)
  ? createBrevoSender({
      apiKey: config.BREVO_API_KEY!,
      fromAddress: config.EMAIL_FROM_ADDRESS,
      fromName: config.EMAIL_FROM_NAME,
    })
  : createLogSender((m) => console.log(m));
const rebalance = startRebalanceJobs(redis, db, {
  info: (m) => console.log(m),
  error: (m) => console.error(m),
});
const app = buildApp({
  db,
  redis,
  config,
  enqueueInviteEmail: queue,
  sendMail: (m) => sender.send(m),
  enqueueRebalance: rebalance.enqueue,
});

const worker = startInviteEmailWorker(redis, sender, (m) => app.log.error(m));
const autoClose = await startAutoCloseJobs(redis, db, {
  info: (m) => app.log.info(m),
  error: (m) => app.log.error(m),
});

const trials = startTrialExpiry(db, {
  info: (m) => app.log.info(m),
  error: (m) => app.log.error(m),
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await worker.close();
    await autoClose.close();
    await trials.close();
    await rebalance.close();
    await queue.close();
    await app.close();
    redis.disconnect();
    await close();
    process.exit(0);
  });
}

await app.listen({ port: config.API_PORT, host: config.API_HOST });
