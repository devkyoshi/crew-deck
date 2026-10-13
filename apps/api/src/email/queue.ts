import type { Redis } from 'ioredis';
import { createTenantQueue, createTenantWorker, type TenantJobData } from '../lib/redis.js';
import type { EmailSender } from './sender.js';
import { inviteEmail } from './templates.js';

export interface InviteEmailJob extends TenantJobData {
  to: string;
  link: string;
  orgName: string;
  inviterName: string;
  expiresInDays: number;
}

export type EnqueueInviteEmail = (job: InviteEmailJob) => Promise<void>;

const QUEUE = 'invite-email';

export function createInviteEmailQueue(
  redis: Redis,
): EnqueueInviteEmail & { close(): Promise<void> } {
  const queue = createTenantQueue<InviteEmailJob>(QUEUE, redis);
  const enqueue: EnqueueInviteEmail = async (job) => {
    await queue.add('send', job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
  };
  return Object.assign(enqueue, { close: () => queue.close() });
}

export function startInviteEmailWorker(
  redis: Redis,
  sender: EmailSender,
  log: (m: string) => void,
) {
  const worker = createTenantWorker<InviteEmailJob>(QUEUE, redis, async (job) => {
    const d = job.data;
    const mail = inviteEmail({
      orgName: d.orgName,
      inviterName: d.inviterName,
      link: d.link,
      expiresInDays: d.expiresInDays,
    });
    await sender.send({ to: d.to, ...mail });
  });
  worker.on('failed', (job, err) => log(`invite email job ${job?.id} failed: ${err.message}`));
  return worker;
}
