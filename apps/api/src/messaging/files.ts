import { randomUUID } from 'node:crypto';
import type { AttachmentDTO } from '@crew-deck/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import { AppError, notFound } from '../lib/errors.js';
import type { Actor } from '../permissions/can.js';
import { assertWithinLimit, loadPlan, storageBytes } from '../plans/index.js';
import type { StorageDriver } from '../storage/index.js';
import { receiveUpload } from '../storage/receive.js';
import { loadChannel, requireChannel } from './access.js';
import { attachmentDTO, peopleOf } from './dto.js';

const MB = 1024 * 1024;
/** Files uploaded but not yet sent in a message, per person. */
const MAX_PENDING_PER_USER = 20;

/**
 * Takes one file from a multipart request into storage for a channel. The file waits, unattached,
 * until a message that carries it is sent; unsent files are swept after a day. Plan limits on file
 * size and total storage apply, and programs and scripts are refused (see `receiveUpload`).
 */
export async function receiveChannelFile(
  req: FastifyRequest,
  deps: { db: Db; storage: StorageDriver },
  actor: Actor,
  channelId: string,
): Promise<AttachmentDTO> {
  if (!req.isMultipart())
    throw new AppError(415, 'unsupported_media_type', 'Send the file as multipart/form-data');
  const t = deps.db.tenant(actor.orgId);
  const access = await loadChannel(t, actor, channelId);
  requireChannel(actor, access, 'channel.post');
  if (
    (await t.messageAttachments.count({ uploaderId: actor.userId, messageId: null })) >=
    MAX_PENDING_PER_USER
  ) {
    throw new AppError(429, 'too_many_uploads', 'Send or remove the files you already added first');
  }
  const plan = await loadPlan(t, actor.orgId);
  const used = await storageBytes(t);
  const storageMb = plan.limits.storage_mb;
  if (storageMb !== undefined && used >= storageMb * MB)
    assertWithinLimit(plan, 'storage_mb', storageMb, 1);

  // Four id segments, like every storage key: workspace / channel / upload / file.
  const key = `${actor.orgId}/${channelId}/${randomUUID()}/${randomUUID()}`;
  const got = await receiveUpload(req, deps.storage, key, plan, used);
  try {
    const row = await t.messageAttachments.insert({
      channelId,
      uploaderId: actor.userId,
      name: got.name,
      mime: got.mime,
      image: got.image,
      size: got.size,
      storageKey: key,
    });
    return attachmentDTO(row);
  } catch (e) {
    await deps.storage.delete(key);
    throw e;
  }
}

/** Removes a file I uploaded but have not sent yet. */
export async function discardChannelFile(
  deps: { db: Db; storage: StorageDriver },
  actor: Actor,
  fileId: string,
) {
  const t = deps.db.tenant(actor.orgId);
  const f = await t.messageAttachments.findOne({
    id: fileId,
    uploaderId: actor.userId,
    messageId: null,
  });
  if (!f) throw notFound('File');
  await t.messageAttachments.deleteOne({ id: f.id });
  await deps.storage.delete(f.storageKey);
}

/**
 * Streams a message file after checking that the person can see its channel (members, or anyone for a
 * public channel). Only real images are shown inline; everything else downloads. Unsent files are visible
 * to their uploader only.
 */
export async function serveMessageFile(
  deps: { db: Db; storage: StorageDriver },
  actor: Actor,
  fileId: string,
  reply: FastifyReply,
) {
  const t = deps.db.tenant(actor.orgId);
  const f = await t.messageAttachments.get(fileId);
  if (!f) throw notFound('File');
  await loadChannel(t, actor, f.channelId); // 404 for channels the person cannot see
  if (f.messageId === null && f.uploaderId !== actor.userId) throw notFound('File');
  const inline = f.image !== null;
  const encoded = encodeURIComponent(f.name).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const ascii = f.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return reply
    .header('content-type', inline ? f.image! : 'application/octet-stream')
    .header('content-length', String(f.size))
    .header(
      'content-disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`,
    )
    .header('cache-control', 'private, max-age=600')
    .send(deps.storage.get(f.storageKey));
}

/** The Files tab: what has been shared in a channel, newest first. */
export async function listChannelFiles(
  deps: { db: Db },
  actor: Actor,
  channelId: string,
  limit = 50,
) {
  const t = deps.db.tenant(actor.orgId);
  await loadChannel(t, actor, channelId);
  const rows = await t.messageAttachments.find(
    { channelId, messageId: { $ne: null } },
    { sort: { createdAt: -1 }, limit: Math.min(limit, 100) },
  );
  const people = await peopleOf(
    t,
    rows.map((r) => r.uploaderId),
  );
  const messages = await t.messages.find(
    { id: { $in: rows.map((r) => r.messageId!) } },
    { projection: { id: 1, seq: 1 } },
  );
  const seqOf = new Map(messages.map((m) => [m.id, m.seq]));
  return rows.map((r) => ({
    ...attachmentDTO(r),
    messageId: r.messageId!,
    seq: seqOf.get(r.messageId!) ?? null,
    uploader: people.get(r.uploaderId) ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Removes files that were uploaded but never sent (older than `maxAgeMs`). */
export async function sweepUnsentFiles(db: Db, storage: StorageDriver, maxAgeMs = 24 * 3600_000) {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const stale = await db.global.all.messageAttachments.find(
    { messageId: null, createdAt: { $lt: cutoff } },
    { limit: 500 },
  );
  for (const f of stale) {
    await db.global.all.messageAttachments.deleteOne({ id: f.id });
    await storage.delete(f.storageKey).catch(() => undefined);
  }
  return stale.length;
}
