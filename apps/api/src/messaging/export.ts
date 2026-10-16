import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import type { ChatExportDTO } from '@crew-deck/shared';
import { writeAudit } from '../audit/service.js';
import type { ChatExportDoc } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { can, type Actor } from '../permissions/can.js';
import { runLater, type MessagingCtx } from './context.js';
import { peopleOf } from './dto.js';

/** How long a finished export can be downloaded before it is removed. */
const KEEP_DAYS = 7;
const PAGE = 500;

const present = (e: ChatExportDoc): ChatExportDTO => ({
  id: e.id,
  status: e.status,
  createdAt: e.createdAt.toISOString(),
  finishedAt: e.finishedAt ? e.finishedAt.toISOString() : null,
  expiresAt: e.expiresAt ? e.expiresAt.toISOString() : null,
  sizeBytes: e.sizeBytes,
  counts: e.counts,
  error: e.error,
});

/** One copy at a time per workspace: asking while one is running returns that one's problem, not a second job. */
export async function requestExport(ctx: MessagingCtx, actor: Actor): Promise<ChatExportDTO> {
  if (!can(actor, 'messaging.settings')) throw forbidden();
  if (!ctx.storage) throw new AppError(503, 'unavailable', 'Exports are not available right now');
  const t = ctx.db.tenant(actor.orgId);
  if (await t.chatExports.exists({ status: { $in: ['queued', 'running'] } }))
    throw new AppError(409, 'export_running', 'An export is already being prepared');
  const row = await ctx.db.tx(actor.orgId, async (tx) => {
    const created = await tx.chatExports.insert({ requestedBy: actor.userId });
    await writeAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      action: 'messaging.export_requested',
      targetType: 'settings',
      targetId: actor.orgId,
      after: { exportId: created.id },
    });
    return created;
  });
  runLater(ctx, () => runExport(ctx, actor.orgId, row.id));
  return present(row);
}

export async function listExports(ctx: MessagingCtx, actor: Actor): Promise<ChatExportDTO[]> {
  if (!can(actor, 'messaging.settings')) throw forbidden();
  const rows = await ctx.db.tenant(actor.orgId).chatExports.find({}, { sort: { createdAt: -1 }, limit: 10 });
  return rows.map(present);
}

export async function getExport(ctx: MessagingCtx, actor: Actor, id: string): Promise<ChatExportDTO> {
  if (!can(actor, 'messaging.settings')) throw forbidden();
  const row = await ctx.db.tenant(actor.orgId).chatExports.findOne({ id });
  if (!row) throw notFound('Export');
  return present(row);
}

/** The file of a finished export, as a stream, for the download route. */
export async function exportFile(ctx: MessagingCtx, actor: Actor, id: string) {
  if (!can(actor, 'messaging.settings')) throw forbidden();
  const row = await ctx.db.tenant(actor.orgId).chatExports.findOne({ id });
  if (!row || row.status !== 'done' || !row.storageKey || !ctx.storage) throw notFound('Export');
  if (row.expiresAt && row.expiresAt < new Date())
    throw new AppError(410, 'export_expired', 'That export has expired. Make a new one.');
  return { stream: ctx.storage.get(row.storageKey), size: row.sizeBytes ?? undefined };
}

/**
 * What goes into a copy: the workspace's public channels with their messages, reactions and file names
 * (not the files), and the people who wrote them. Private channels and direct messages are left out on
 * purpose: nobody in the workspace, administrators included, can read them through the app, so an export
 * does not become a way around that. One JSON object per line, compressed.
 */
async function* lines(ctx: MessagingCtx, orgId: string) {
  const t = ctx.db.tenant(orgId);
  yield { type: 'export', version: 1, workspace: orgId, generatedAt: new Date().toISOString(), scope: 'public channels' };
  const channels = await t.channels.find({ type: 'public' }, { sort: { createdAt: 1 } });
  const seen = new Set<string>();
  for (const c of channels) {
    yield {
      type: 'channel',
      id: c.id,
      name: c.name,
      topic: c.topic,
      description: c.description,
      isArchived: c.isArchived,
      isAnnouncement: c.isAnnouncement,
      spaceId: c.spaceId,
      createdAt: c.createdAt.toISOString(),
    };
    let after = 0;
    for (;;) {
      const rows = await t.messages.find({ channelId: c.id, seq: { $gt: after } }, { sort: { seq: 1 }, limit: PAGE });
      if (rows.length === 0) break;
      after = rows[rows.length - 1]!.seq;
      const ids = rows.map((r) => r.id);
      const [reactions, files] = await Promise.all([
        t.messageReactions.find({ messageId: { $in: ids } }),
        t.messageAttachments.find({ messageId: { $in: ids } }),
      ]);
      const people = await peopleOf(t, rows.map((r) => r.authorId).filter((x): x is string => !!x && !seen.has(x)));
      for (const [id, p] of people) {
        seen.add(id);
        yield { type: 'person', id, name: p.name, email: p.email, deactivated: p.deactivated === true };
      }
      for (const m of rows) {
        yield {
          type: 'message',
          channelId: c.id,
          id: m.id,
          seq: m.seq,
          kind: m.kind,
          authorId: m.authorId,
          bot: m.botId,
          text: m.bodyText,
          body: m.body,
          threadRootId: m.threadRootId,
          createdAt: m.createdAt.toISOString(),
          editedAt: m.editedAt ? m.editedAt.toISOString() : null,
          deleted: m.deletedAt !== null,
          reactions: reactions.filter((r) => r.messageId === m.id).map((r) => ({ emoji: r.emoji, userId: r.userId })),
          files: files.filter((f) => f.messageId === m.id).map((f) => ({ name: f.name, size: f.size, type: f.image })),
        };
      }
    }
  }
}

export async function runExport(ctx: MessagingCtx, orgId: string, id: string) {
  const t = ctx.db.tenant(orgId);
  const storage = ctx.storage;
  if (!storage) return;
  await t.chatExports.updateOne({ id }, { status: 'running' });
  try {
    let messages = 0;
    let channels = 0;
    const counted = (async function* () {
      for await (const line of lines(ctx, orgId)) {
        if ((line as { type: string }).type === 'message') messages++;
        if ((line as { type: string }).type === 'channel') channels++;
        yield `${JSON.stringify(line)}\n`;
      }
    })();
    const key = `${orgId}/${id}/${randomUUID()}/${randomUUID()}`;
    const bytes = await storage.put(key, Readable.from(counted), createGzip());
    await t.chatExports.updateOne(
      { id },
      {
        status: 'done',
        storageKey: key,
        sizeBytes: bytes,
        counts: { channels, messages },
        finishedAt: new Date(),
        expiresAt: new Date(Date.now() + KEEP_DAYS * 86_400_000),
      },
    );
  } catch (e) {
    await t.chatExports.updateOne({ id }, { status: 'failed', error: (e as Error).message.slice(0, 200), finishedAt: new Date() });
  }
}

/** Removes the files of exports past their time. Called by the hourly job. */
export async function expireExports(ctx: MessagingCtx, orgId: string, now = new Date()) {
  const t = ctx.db.tenant(orgId);
  const old = await t.chatExports.find({ expiresAt: { $lt: now } });
  for (const e of old) {
    if (e.storageKey) await ctx.storage?.delete(e.storageKey).catch(() => undefined);
    await t.chatExports.deleteOne({ id: e.id });
  }
  return old.length;
}
