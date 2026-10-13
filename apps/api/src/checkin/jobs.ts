import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Db } from '../db/client.js';
import { createTenantQueue, createTenantWorker, type TenantJobData } from '../lib/redis.js';
import { autoCloseOrg, listOrgIds } from './service.js';

const TICK_QUEUE = 'work-tick';
const ORG_QUEUE = 'work-auto-close';
const EVERY_MS = 60_000;

/**
 * Every minute a tick (which belongs to no tenant) lists the workspaces and queues one job per
 * workspace. Each of those jobs carries its org id and runs inside that tenant's context, like every
 * other job.
 */
export async function startAutoCloseJobs(
  redis: Redis,
  db: Db,
  log: { info: (m: string) => void; error: (m: string) => void },
) {
  const tickQueue = new Queue(TICK_QUEUE, { connection: redis });
  const orgQueue = createTenantQueue<TenantJobData>(ORG_QUEUE, redis);

  // One repeatable schedule, however many API instances start.
  await tickQueue.upsertJobScheduler(
    'every-minute',
    { every: EVERY_MS },
    { name: 'tick', opts: { removeOnComplete: true, removeOnFail: 20 } },
  );

  const tickWorker = new Worker(
    TICK_QUEUE,
    async () => {
      for (const orgId of await listOrgIds(db)) {
        // A fixed job id per workspace and minute stops duplicates if two instances tick together.
        await orgQueue.add(
          'close',
          { orgId },
          {
            jobId: `${orgId}-${Math.floor(Date.now() / EVERY_MS)}`,
            removeOnComplete: true,
            removeOnFail: 50,
          },
        );
      }
    },
    { connection: redis },
  );

  const orgWorker = createTenantWorker<TenantJobData>(ORG_QUEUE, redis, async (_job, orgId) => {
    const closed = await autoCloseOrg(db, orgId);
    if (closed > 0) log.info(`auto-closed ${closed} forgotten check-out(s) in workspace ${orgId}`);
  });

  for (const w of [tickWorker, orgWorker])
    w.on('failed', (job, err) => log.error(`${w.name} job ${job?.id} failed: ${err.message}`));

  return {
    async close() {
      await Promise.all([
        tickWorker.close(),
        orgWorker.close(),
        tickQueue.close(),
        orgQueue.close(),
      ]);
    },
  };
}
