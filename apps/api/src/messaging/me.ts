import { S2C } from '@crew-deck/shared';
import type { Actor } from '../permissions/can.js';
import type { MessagingCtx } from './context.js';
import { announcePresence, type Presence } from './presence.js';

const presenceOf = (ctx: MessagingCtx): Presence => {
  if (!ctx.presence) throw new Error('presence is not configured');
  return ctx.presence;
};

export interface StatusInput {
  emoji: string | null;
  text: string | null;
  expiresAt?: Date | null;
}

/** Sets (or, with nothing in it, clears) the caller's custom status and tells everyone's presence dots. */
export async function setCustomStatus(ctx: MessagingCtx, actor: Actor, input: StatusInput) {
  const t = ctx.db.tenant(actor.orgId);
  const clear = !input.emoji && !input.text;
  await t.userStatuses.upsert(
    { userId: actor.userId },
    {
      emoji: clear ? null : input.emoji,
      text: clear ? null : input.text,
      expiresAt: clear ? null : (input.expiresAt ?? null),
    },
  );
  ctx.events.toOrg(actor.orgId, S2C.presenceChanged, {
    userId: actor.userId,
    state: await presenceOf(ctx).stateOf(actor.orgId, actor.userId),
  });
}

/** Starts (minutes) or ends (null) do not disturb. Returns when it ends. */
export async function setDoNotDisturb(ctx: MessagingCtx, actor: Actor, minutes: number | null) {
  const presence = presenceOf(ctx);
  const change = await presence.setDnd(actor.orgId, actor.userId, minutes);
  announcePresence(ctx, actor.orgId, actor.userId, change);
  return presence.dndUntil(actor.orgId, actor.userId);
}

/** Available (automatic), Away, or Do not disturb (for `minutes`, default an hour). */
export async function setPresenceMode(
  ctx: MessagingCtx,
  actor: Actor,
  mode: 'auto' | 'away' | 'dnd',
  minutes?: number,
) {
  const presence = presenceOf(ctx);
  const change =
    mode === 'dnd'
      ? await presence.setDnd(actor.orgId, actor.userId, minutes ?? 60)
      : mode === 'away'
        ? await presence.setAway(actor.orgId, actor.userId, true)
        : await presence.setAway(actor.orgId, actor.userId, false);
  announcePresence(ctx, actor.orgId, actor.userId, change);
  return { state: change.after, until: await presence.dndUntil(actor.orgId, actor.userId) };
}
