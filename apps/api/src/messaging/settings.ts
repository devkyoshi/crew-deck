import {
  MESSAGING_SETTINGS_DEFAULTS,
  messagingSettingsSchema,
  type MessagingSettingsDTO,
  type MessagingSettingsResponse,
} from '@crew-deck/shared';
import { writeAudit } from '../audit/service.js';
import type { TenantDb } from '../db/client.js';
import { AppError, forbidden } from '../lib/errors.js';
import { can, type Actor } from '../permissions/can.js';
import type { MessagingCtx } from './context.js';
import { checkinBadges } from './people.js';

/** The workspace's chat rules, or the defaults when nobody has changed them. Cheap: one small read. */
export async function loadMessagingSettings(t: TenantDb): Promise<MessagingSettingsDTO> {
  const row = await t.messagingSettings.findOne({});
  if (!row) return { ...MESSAGING_SETTINGS_DEFAULTS };
  return {
    channelCreation: row.channelCreation,
    broadcastLimit: row.broadcastLimit,
    defaultChannelIds: row.defaultChannelIds,
    retentionDays: row.retentionDays,
    spaceChannels: row.spaceChannels,
    announcementDefault: row.announcementDefault,
    leaveSetsDnd: row.leaveSetsDnd,
  };
}

async function withNames(t: TenantDb, s: MessagingSettingsDTO): Promise<MessagingSettingsResponse> {
  const channels = s.defaultChannelIds.length
    ? await t.channels.find({ id: { $in: s.defaultChannelIds } })
    : [];
  return {
    ...s,
    defaultChannels: s.defaultChannelIds.flatMap((id) => {
      const c = channels.find((x) => x.id === id);
      return c?.name ? [{ id, name: c.name }] : [];
    }),
  };
}

export async function getMessagingSettings(
  ctx: MessagingCtx,
  actor: Actor,
): Promise<MessagingSettingsResponse> {
  if (!can(actor, 'messaging.settings')) throw forbidden();
  const t = ctx.db.tenant(actor.orgId);
  return withNames(t, await loadMessagingSettings(t));
}

/**
 * Replaces the workspace's chat rules (the owner only). Default channels must be public or private channels
 * of this workspace (never a direct message). The change is audited with what it was and what it became.
 */
export async function updateMessagingSettings(
  ctx: MessagingCtx,
  actor: Actor,
  input: unknown,
): Promise<MessagingSettingsResponse> {
  if (!can(actor, 'messaging.settings')) throw forbidden();
  const parsed = messagingSettingsSchema.safeParse(input);
  if (!parsed.success) throw new AppError(400, 'validation_error', 'Those settings are not valid');
  const next = { ...parsed.data, defaultChannelIds: [...new Set(parsed.data.defaultChannelIds)] };
  const t = ctx.db.tenant(actor.orgId);
  if (next.defaultChannelIds.length) {
    const found = await t.channels.find({
      id: { $in: next.defaultChannelIds },
      type: { $in: ['public', 'private'] },
    });
    if (found.length !== next.defaultChannelIds.length)
      throw new AppError(422, 'validation_error', 'A default channel does not exist', {
        defaultChannelIds: 'Choose channels from this workspace',
      });
  }
  const before = await loadMessagingSettings(t);
  await ctx.db.tx(actor.orgId, async (tx) => {
    await tx.messagingSettings.upsert({}, { ...next, updatedAt: new Date() });
    await writeAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      action: 'messaging.settings_changed',
      targetType: 'settings',
      targetId: actor.orgId,
      before,
      after: next,
    });
  });
  return withNames(t, next);
}

/** True when the workspace lets "on leave" act as do not disturb and this person is on leave today. */
export async function silencedByLeave(t: TenantDb, userId: string, now = new Date()): Promise<boolean> {
  const settings = await loadMessagingSettings(t);
  if (!settings.leaveSetsDnd) return false;
  return (await checkinBadges(t, [userId], now)).get(userId) === 'leave';
}
