import type { CheckinBadge, ProfileCardDTO } from '@crew-deck/shared';
import type { TenantDb } from '../db/client.js';
import { loadSettings } from '../checkin/service.js';
import { notFound } from '../lib/errors.js';
import { isValidTimezone, localDate } from '../lib/time.js';
import type { Actor } from '../permissions/can.js';
import { loadVisibleSpaces } from '../spaces/access.js';
import { peopleOf } from './dto.js';
import type { MessagingCtx } from './context.js';

/**
 * Where people are working today, as a status only: onsite, remote, offsite or on leave. Exact times of
 * check-in and check-out are never part of this (the check-in module's privacy rule). Nothing at all
 * when the workspace has the check-in module switched off, or for someone who is not in today.
 */
export async function checkinBadges(
  t: TenantDb,
  userIds: string[],
  now = new Date(),
): Promise<Map<string, CheckinBadge>> {
  const out = new Map<string, CheckinBadge>();
  if (userIds.length === 0) return out;
  const settings = await loadSettings(t, t.orgId);
  if (!settings.checkinEnabled) return out;
  const users = await t.users(userIds);
  const dateOf = new Map(
    userIds.map((id) => {
      const tz = users.get(id)?.timezone;
      return [id, localDate(now, tz && isValidTimezone(tz) ? tz : 'UTC')] as const;
    }),
  );
  const days = await t.workDays.find({
    userId: { $in: userIds },
    date: { $in: [...new Set(dateOf.values())] },
  });
  for (const d of days) {
    if (d.date !== dateOf.get(d.userId)) continue;
    if (d.plannedLocation === 'leave' && !d.checkinAt) out.set(d.userId, 'leave');
    else if (d.checkinAt && !d.checkoutAt && d.locationType && d.locationType !== 'holiday')
      out.set(d.userId, d.locationType);
  }
  return out;
}

/**
 * The card behind a name: who they are, where they are (status only), and what they are up to. Only for
 * active people in the caller's workspace; anyone else is simply not found.
 */
export async function profileCard(
  ctx: MessagingCtx,
  actor: Actor,
  userId: string,
): Promise<ProfileCardDTO> {
  const t = ctx.db.tenant(actor.orgId);
  const member = await t.memberships.findOne({ userId, status: 'active' });
  if (!member) throw notFound('Person');
  const person = (await peopleOf(t, [userId])).get(userId);
  const user = (await t.users([userId])).get(userId);
  if (!person || !user) throw notFound('Person');
  const [badges, links, statusRow, state, mine] = await Promise.all([
    checkinBadges(t, [userId]),
    t.groupMembers.find({ userId }),
    t.userStatuses.findOne({ userId }),
    ctx.presence?.stateOf(actor.orgId, userId),
    // Open work they hold in spaces the caller can see: a count, never the items themselves.
    loadVisibleSpaces(t, actor),
  ]);
  const groups = links.length ? await t.groups.find({ id: { $in: links.map((l) => l.groupId) } }) : [];
  const visible = mine.map((s) => s.id);
  const items = visible.length
    ? await t.workItems.find(
        { assigneeId: userId, deletedAt: null, spaceId: { $in: visible } },
        { projection: { statusId: 1 } },
      )
    : [];
  const statuses = items.length
    ? await t.spaceStatuses.find({ id: { $in: [...new Set(items.map((i) => i.statusId))] } })
    : [];
  const done = new Set(statuses.filter((s) => s.category === 'done').map((s) => s.id));
  const status =
    statusRow && (!statusRow.expiresAt || statusRow.expiresAt.getTime() > Date.now())
      ? { emoji: statusRow.emoji, text: statusRow.text }
      : null;
  return {
    id: userId,
    name: person.name,
    email: person.email,
    avatarUrl: person.avatarUrl,
    jobTitle: user.jobTitle ?? null,
    timezone: user.timezone && isValidTimezone(user.timezone) ? user.timezone : null,
    groups: groups.map((g) => g.name).sort(),
    status,
    checkin: badges.get(userId) ?? null,
    presence: state ?? 'offline',
    openItems: items.filter((i) => !done.has(i.statusId)).length,
  };
}
