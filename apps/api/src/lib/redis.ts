import { Queue, Worker, type Job, type Processor } from 'bullmq';
import { Redis } from 'ioredis';

export function createRedis(url: string) {
  // BullMQ requires maxRetriesPerRequest: null on its connections.
  return new Redis(url, { maxRetriesPerRequest: null });
}

/** All Redis keys are tenant-prefixed: org:{id}:... */
export const orgKey = (orgId: string, ...parts: string[]) => ['org', orgId, ...parts].join(':');

export interface TenantJobData {
  orgId: string;
}

export function createTenantQueue<T extends TenantJobData>(name: string, connection: Redis) {
  return new Queue<T>(name, { connection });
}

/** Wraps a processor so every job must carry org_id and runs with that tenant's context. */
export function createTenantWorker<T extends TenantJobData>(
  name: string,
  connection: Redis,
  handler: (job: Job<T>, orgId: string) => Promise<unknown>,
) {
  const processor: Processor<T> = async (job) => {
    const orgId = job.data?.orgId;
    if (!orgId) throw new Error(`Job ${job.id} on ${name} is missing orgId`);
    return handler(job, orgId);
  };
  return new Worker<T>(name, processor, { connection });
}
