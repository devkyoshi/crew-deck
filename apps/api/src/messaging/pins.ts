import type { MessageDTO } from '@crew-deck/shared';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { can, type Actor } from '../permissions/can.js';
import { loadChannel } from './access.js';
import type { MessagingCtx } from './context.js';
import { hydrate } from './dto.js';
import { loadMessage, publishUpdated } from './messages.js';

/** Pinned messages: channel owners and org admins pin, everyone in the channel reads them. */
export async function setPinned(
  ctx: MessagingCtx,
  actor: Actor,
  messageId: string,
  pinned: boolean,
): Promise<MessageDTO> {
  const t = ctx.db.tenant(actor.orgId);
  const { msg, access } = await loadMessage(t, actor, messageId);
  if (msg.deletedAt || msg.kind === 'system') throw notFound('Message');
  if (!can(actor, 'message.pin', access.resource)) {
    if (access.channel.isArchived)
      throw new AppError(409, 'channel_archived', 'This channel is archived and read-only');
    throw forbidden();
  }
  if (pinned)
    await t.pins.insertIgnore({ channelId: msg.channelId, messageId, pinnedBy: actor.userId });
  else await t.pins.deleteOne({ channelId: msg.channelId, messageId });
  return publishUpdated(ctx, t, actor.orgId, msg);
}

export async function listPins(
  ctx: MessagingCtx,
  actor: Actor,
  channelId: string,
): Promise<MessageDTO[]> {
  const t = ctx.db.tenant(actor.orgId);
  await loadChannel(t, actor, channelId);
  const pins = await t.pins.find({ channelId }, { sort: { pinnedAt: -1 }, limit: 100 });
  if (pins.length === 0) return [];
  const rows = await t.messages.find({ id: { $in: pins.map((p) => p.messageId) } });
  const byId = new Map(rows.map((m) => [m.id, m]));
  const ordered = pins
    .map((p) => byId.get(p.messageId))
    .filter((m): m is NonNullable<typeof m> => !!m && !m.deletedAt);
  return hydrate(t, ordered);
}

// ---- Saved for later -----------------------------------------------------------------------------------

export async function setSaved(ctx: MessagingCtx, actor: Actor, messageId: string, saved: boolean) {
  const t = ctx.db.tenant(actor.orgId);
  // Removing a saved message always works, even after losing access to its channel.
  if (!saved) {
    await t.savedMessages.deleteOne({ userId: actor.userId, messageId });
    return { saved: false };
  }
  const { msg, access } = await loadMessage(t, actor, messageId);
  if (!can(actor, 'message.save', access.resource)) throw forbidden();
  if (msg.deletedAt) throw notFound('Message');
  await t.savedMessages.upsert(
    { userId: actor.userId, messageId },
    {},
    { channelId: msg.channelId },
  );
  return { saved };
}

/** My saved messages, newest first, only from conversations I can still see. */
export async function listSaved(ctx: MessagingCtx, actor: Actor) {
  const t = ctx.db.tenant(actor.orgId);
  const saved = await t.savedMessages.find(
    { userId: actor.userId },
    { sort: { savedAt: -1 }, limit: 200 },
  );
  if (saved.length === 0) return [];
  const [rows, channels, mine] = await Promise.all([
    t.messages.find({ id: { $in: saved.map((s) => s.messageId) } }),
    t.channels.find({ id: { $in: [...new Set(saved.map((s) => s.channelId))] } }),
    t.channelMembers.find({ userId: actor.userId }),
  ]);
  const member = new Set(mine.map((m) => m.channelId));
  const channelOf = new Map(channels.map((c) => [c.id, c]));
  const byId = new Map(rows.map((m) => [m.id, m]));
  const visible = saved.filter((s) => {
    const c = channelOf.get(s.channelId);
    return !!c && !!byId.get(s.messageId) && (c.type === 'public' || member.has(c.id));
  });
  const dtos = new Map(
    (
      await hydrate(
        t,
        visible.map((s) => byId.get(s.messageId)!),
      )
    ).map((d) => [d.id, d]),
  );
  return visible.map((s) => ({
    message: dtos.get(s.messageId)!,
    channel: {
      id: s.channelId,
      type: channelOf.get(s.channelId)!.type,
      name: channelOf.get(s.channelId)!.name,
    },
    savedAt: s.savedAt.toISOString(),
  }));
}
