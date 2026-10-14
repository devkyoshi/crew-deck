import type { Redis } from 'ioredis';
import type { Db } from '../db/client.js';
import { withTenant } from '../db/client.js';
import { createTenantQueue, createTenantWorker, type TenantJobData } from '../lib/redis.js';
import { lockSpace, rebalanceColumn } from './service.js';

const QUEUE = 'work-rank-rebalance';

export interface RebalanceJob extends TenantJobData {
  spaceId: string;
  statusId: string;
}
export type EnqueueRebalance = (job: RebalanceJob) => Promise<void> | void;

/** Rewrites one column's ranks inside the tenant's context, under the same lock moves use. */
export async function runRebalance(db: Db, job: RebalanceJob) {
  return withTenant(db, job.orgId, async (tx) => {
    await lockSpace(tx, job.spaceId);
    return rebalanceColumn(tx, job.spaceId, job.statusId);
  });
}

/**
 * Ranks only grow when people keep inserting at the same spot, so a move that produces a long key
 * queues a rebalance for its column. A fixed job id per column collapses duplicates.
 */
export function startRebalanceJobs(
  redis: Redis,
  db: Db,
  log: { info: (m: string) => void; error: (m: string) => void },
) {
  const queue = createTenantQueue<RebalanceJob>(QUEUE, redis);
  const worker = createTenantWorker<RebalanceJob>(QUEUE, redis, async (job) => {
    const n = await runRebalance(db, job.data);
    log.info(`rebalanced ${n} ranks in one column`);
  });
  worker.on('failed', (job, err) => log.error(`rank rebalance failed: ${err.message} (${job?.id})`));
  const enqueue: EnqueueRebalance = async (job) => {
    await queue.add('rebalance', job, {
      jobId: `${job.orgId}-${job.statusId}`,
      removeOnComplete: true,
      removeOnFail: 20,
    });
  };
  return {
    enqueue,
    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
