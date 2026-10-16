import type { TenantDb } from '../db/client.js';
import type { ChannelDoc, ChannelMemberDoc } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { can, type Action, type Actor, type Resource } from '../permissions/can.js';

export interface ChannelAccess {
  channel: ChannelDoc;
  member: ChannelMemberDoc | null;
  resource: Resource;
}

export const channelResource = (
  channel: ChannelDoc,
  member: ChannelMemberDoc | null,
): Resource => ({
  channelType: channel.type,
  channelRole: member?.role ?? null,
  isArchived: channel.isArchived,
  isAnnouncement: channel.isAnnouncement,
});

/**
 * Loads a channel for a caller. A channel the caller may not see is reported as missing (never as
 * forbidden), so private channel and DM ids cannot be probed. Used by the REST routes and the gateway.
 */
export async function loadChannel(
  t: TenantDb,
  actor: Actor,
  channelId: string,
): Promise<ChannelAccess> {
  const channel = await t.channels.get(channelId);
  if (!channel) throw notFound('Channel');
  const member = await t.channelMembers.findOne({ channelId, userId: actor.userId });
  const resource = channelResource(channel, member);
  if (!can(actor, 'channel.view', resource)) throw notFound('Channel');
  return { channel, member, resource };
}

/** Throws unless the caller may do `action` here. Archived channels answer with their own message. */
export function requireChannel(actor: Actor, access: ChannelAccess, action: Action) {
  if (can(actor, action, access.resource)) return;
  if (access.channel.isArchived && (action === 'channel.post' || action === 'message.editOwn')) {
    throw new AppError(409, 'channel_archived', 'This channel is archived and read-only');
  }
  throw forbidden();
}
