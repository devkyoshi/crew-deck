import { buildApp } from './app.js';
import { emailEnabled, loadConfig } from './config.js';
import { createDb, ensureIndexes } from './db/client.js';
import { ensurePlans } from './db/reference.js';
import { startAutoCloseJobs } from './checkin/jobs.js';
import { createInviteEmailQueue, startInviteEmailWorker } from './email/queue.js';
import { createBrevoSender, createLogSender } from './email/sender.js';
import { createRedis } from './lib/redis.js';
import { startTrialExpiry } from './plans/jobs.js';
import { startRebalanceJobs } from './work/jobs.js';
import { startNotificationJobs } from './work/notify-jobs.js';
import { RedisEventSink } from './messaging/events.js';
import { Presence } from './messaging/presence.js';
import { startMessageEmailJobs } from './messaging/notify.js';
import { startLinkPreviewJobs } from './messaging/link-preview.js';
import { sweepUnsentFiles } from './messaging/files.js';
import { startActivityBotJobs } from './messaging/activity-bot.js';
import { startRetentionJobs } from './messaging/retention.js';
import { reconcileAll } from './messaging/space-channels.js';
import { createStorage } from './storage/index.js';
import { startSprintSnapshots } from './work/sprints.js';

const config = loadConfig();
const { db, close } = await createDb(config.MONGODB_URI, config.MONGODB_DB);
await ensureIndexes(db.handle);
await ensurePlans(db);
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
const storage = createStorage(config);
const linkPreviews = startLinkPreviewJobs(redis, db, new RedisEventSink(redis), {
  error: (m) => console.error(m),
});
// Files uploaded to a channel but never sent are removed after a day.
const sweep = setInterval(
  () => {
    void sweepUnsentFiles(db, storage).catch((e: Error) =>
      console.error(`file sweep failed: ${e.message}`),
    );
  },
  60 * 60 * 1000,
);
const chatPresence = new Presence(redis);
const messageEmails = startMessageEmailJobs(db, (o, u) => chatPresence.isDnd(o, u), {
  error: (m) => console.error(m),
});
// Nightly repair of space channels (drift from missed events). Runs at startup too, which creates the
// channels of spaces that existed before messaging did.
const spaceSyncCtx = { db, events: new RedisEventSink(redis), storage };
const reconcileSpaces = () =>
  void reconcileAll(spaceSyncCtx, { error: (m) => console.error(m) });
setTimeout(reconcileSpaces, 15_000).unref();
const spaceRepair = setInterval(reconcileSpaces, 24 * 60 * 60 * 1000);
const retention = await startRetentionJobs(redis, db, spaceSyncCtx, { error: (m) => console.error(m) });
const activityBot = await startActivityBotJobs(redis, db, spaceSyncCtx, {
  error: (m) => console.error(m),
});
const app = buildApp({
  storage,
  enqueueLinkPreviews: linkPreviews.enqueue,
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

const notifications = startNotificationJobs(db, config, (m) => sender.send(m), {
  info: (m) => app.log.info(m),
  error: (m) => app.log.error(m),
});

const snapshots = startSprintSnapshots(db, { error: (m) => app.log.error(m) });

const trials = startTrialExpiry(db, {
  info: (m) => app.log.info(m),
  error: (m) => app.log.error(m),
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await worker.close();
    clearInterval(sweep);
    clearInterval(spaceRepair);
    await messageEmails.close();
    await activityBot.close();
    await retention.close();
    await linkPreviews.close();
    await autoClose.close();
    await trials.close();
    await notifications.close();
    await snapshots.close();
    await rebalance.close();
    await queue.close();
    await app.close();
    redis.disconnect();
    await close();
    process.exit(0);
  });
}

await app.listen({ port: config.API_PORT, host: config.API_HOST });
