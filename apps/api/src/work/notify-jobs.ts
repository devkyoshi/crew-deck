import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import type { NotificationDoc } from '../db/types.js';
import type { EmailMessage } from '../email/sender.js';
import { slaClockState } from '@crew-deck/shared';
import { notifyOne } from './notify.js';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One line per notification, in plain words. */
export function describeNotification(n: Pick<NotificationDoc, 'type' | 'data'>, actor: string | null) {
  const d = n.data as Record<string, string | null | undefined>;
  const who = actor ?? 'Someone';
  const what = d.key ? `${d.key} ${d.title ?? ''}`.trim() : 'a work item';
  switch (n.type) {
    case 'assigned':
      return `${who} assigned ${what} to you`;
    case 'mentioned':
      return `${who} mentioned you on ${what}`;
    case 'commented':
      return `${who} commented on ${what}${d.excerpt ? `: “${d.excerpt}”` : ''}`;
    case 'status_changed':
      return `${who} moved ${what} from ${d.from} to ${d.to}`;
    case 'due_soon':
      return `${what} is due ${d.when === 'today' ? 'today' : 'tomorrow'}`;
    case 'ticket_received':
      return `${who} raised ${what}`;
    case 'sla_due_soon':
      return `${what} is close to its ${d.clock === 'response' ? 'response' : 'resolve'} deadline`;
    case 'sla_breached':
      return `${what} missed its ${d.clock === 'response' ? 'response' : 'resolve'} deadline`;
    case 'sprint_started':
      return `${who} started ${d.sprint ?? 'a sprint'} in ${d.spaceKey}`;
    case 'sprint_completed':
      return `${who} completed ${d.sprint ?? 'a sprint'} in ${d.spaceKey}`;
  }
}

/** The link to the thing a notification is about, on the workspace's own address. */
export function linkFor(config: Pick<Config, 'TENANT_ORIGIN_TEMPLATE'>, slug: string, n: Pick<NotificationDoc, 'data'>) {
  const origin = config.TENANT_ORIGIN_TEMPLATE.replace('{slug}', slug);
  const d = n.data as Record<string, string | undefined>;
  if (d.key && d.spaceKey) return `${origin}/spaces/${d.spaceKey}/items/${d.key}`;
  if (d.spaceKey) return `${origin}/spaces/${d.spaceKey}/backlog`;
  return `${origin}/notifications`;
}

export function digestEmail(opts: { orgName: string; lines: { text: string; link: string }[]; inboxLink: string }) {
  const n = opts.lines.length;
  const subject = n === 1 ? opts.lines[0]!.text : `${n} updates in ${opts.orgName}`;
  const text = `${opts.lines.map((l) => `- ${l.text}\n  ${l.link}`).join('\n')}\n\nAll notifications: ${opts.inboxLink}\nChange what you receive in your notification settings.`;
  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#1f2430">
  <h2 style="margin:0 0 12px;font-size:18px">${n === 1 ? 'An update' : `${n} updates`} in ${esc(opts.orgName)}</h2>
  <ul style="padding-left:18px">${opts.lines
    .map((l) => `<li style="margin:8px 0"><a href="${esc(l.link)}" style="color:#2f7bff">${esc(l.text)}</a></li>`)
    .join('')}</ul>
  <p style="color:#6b7280;font-size:13px;margin-top:24px"><a href="${esc(opts.inboxLink)}" style="color:#6b7280">All notifications</a> · You can change what you receive in your notification settings.</p>
</div>`;
  return { subject, text, html };
}

/** Sends every email batch that is due, one email per person. Safe to run often and on several instances. */
export async function flushEmailBatches(
  db: Db,
  config: Pick<Config, 'TENANT_ORIGIN_TEMPLATE'>,
  send: (m: EmailMessage) => Promise<void> | void,
  now = new Date(),
) {
  const due = await db.global.all.emailBatches.find({ sentAt: null, dueAt: { $lte: now } }, { limit: 200 });
  let sent = 0;
  for (const b of due) {
    // Claim it first, so two instances never send the same batch.
    const claimed = await db.global.all.emailBatches.updateOne({ id: b.id, sentAt: null }, { sentAt: now });
    if (claimed === 0) continue;
    const t = db.tenant(b.orgId);
    const [org, rows] = await Promise.all([
      t.organization(),
      t.notifications.find({ id: { $in: b.notificationIds }, userId: b.userId }, { sort: { createdAt: 1 } }),
    ]);
    const people = await t.users([b.userId, ...rows.map((r) => r.actorId ?? '')]);
    const to = people.get(b.userId);
    const member = await t.memberships.findOne({ userId: b.userId, status: 'active' });
    if (!org || !to || !member || rows.length === 0) continue;
    const name = (id: string | null) => (id ? (people.get(id)?.name ?? people.get(id)?.email ?? null) : null);
    const lines = rows.map((r) => ({ text: describeNotification(r, name(r.actorId)), link: linkFor(config, org.slug, r) }));
    const inboxLink = `${config.TENANT_ORIGIN_TEMPLATE.replace('{slug}', org.slug)}/notifications`;
    await send({ to: to.email, ...digestEmail({ orgName: org.name, lines, inboxLink }) });
    sent++;
  }
  return sent;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Reminds assignees of open work due today or tomorrow. Runs hourly; each person hears about each
 * item at most once a day (the dedupe key), so running it again changes nothing.
 */
export async function remindDueSoon(db: Db, now = new Date()) {
  const today = day(now);
  const tomorrow = day(new Date(now.getTime() + 86_400_000));
  const items = await db.global.all.workItems.find(
    { dueDate: { $in: [today, tomorrow] }, resolvedAt: null, deletedAt: null, assigneeId: { $ne: null } },
    { limit: 5000 },
  );
  let created = 0;
  for (const item of items) {
    const t = db.tenant(item.orgId);
    const space = await t.spaces.findOne({ id: item.spaceId, deletedAt: null, status: 'active' });
    if (!space) continue;
    const n = await notifyOne(t, space, item, {
      userId: item.assigneeId!,
      type: 'due_soon',
      actorId: null,
      data: { when: item.dueDate === today ? 'today' : 'tomorrow' },
      dedupeKey: `due:${item.id}:${today}`,
    });
    if (n) created++;
  }
  return created;
}

/**
 * Warns about tickets whose response or resolve target is close or missed. Runs with the other hourly
 * jobs; the dedupe key keeps it to one warning and one miss per person, ticket and clock.
 */
export async function sweepSla(db: Db, now = new Date()) {
  const horizon = new Date(now.getTime() + 60 * 60_000);
  const open = (due: string, done: string) => ({ [due]: { $ne: null, $lte: horizon }, [done]: null });
  const items = await db.global.all.workItems.find(
    {
      type: 'ticket',
      deletedAt: null,
      $or: [open('slaResponseDueAt', 'firstResponseAt'), open('slaResolveDueAt', 'resolvedAt')],
    },
    { limit: 5000 },
  );
  let created = 0;
  for (const item of items) {
    const t = db.tenant(item.orgId);
    const space = await t.spaces.findOne({ id: item.spaceId, deletedAt: null, status: 'active' });
    if (!space) continue;
    const clocks = [
      { clock: 'response', state: slaClockState(item.slaResponseDueAt, item.firstResponseAt, now) },
      { clock: 'resolve', state: slaClockState(item.slaResolveDueAt, item.resolvedAt, now) },
    ] as const;
    // Who answers for it: the assignee, or the people who run the desk while nobody has it.
    let who: string[] = item.assigneeId ? [item.assigneeId] : [];
    if (!who.length) {
      const admins = await t.spaceMembers.find({ spaceId: space.id, principalType: 'user', spaceRole: 'admin' });
      who = [...new Set([...admins.map((a) => a.principalId), space.ownerId].filter((x): x is string => !!x))];
    }
    for (const { clock, state } of clocks) {
      if (state !== 'due_soon' && state !== 'breached') continue;
      for (const userId of who) {
        const n = await notifyOne(t, space, item, {
          userId,
          type: state === 'breached' ? 'sla_breached' : 'sla_due_soon',
          actorId: null,
          data: { clock },
          dedupeKey: `sla:${state}:${clock}:${item.id}`,
        });
        if (n) created++;
      }
    }
  }
  return created;
}

export function startNotificationJobs(
  db: Db,
  config: Pick<Config, 'TENANT_ORIGIN_TEMPLATE'>,
  send: (m: EmailMessage) => Promise<void>,
  log: { info(m: string): void; error(m: string): void },
) {
  const flush = () =>
    flushEmailBatches(db, config, send)
      .then((n) => n && log.info(`sent ${n} notification email(s)`))
      .catch((e: Error) => log.error(`notification emails failed: ${e.message}`));
  const remind = () =>
    remindDueSoon(db)
      .then((n) => n && log.info(`created ${n} due-date reminder(s)`))
      .catch((e: Error) => log.error(`due-date reminders failed: ${e.message}`));
  const sweep = () =>
    sweepSla(db)
      .then((n) => n && log.info(`created ${n} ticket deadline notification(s)`))
      .catch((e: Error) => log.error(`ticket deadline sweep failed: ${e.message}`));
  void remind();
  void sweep();
  const a = setInterval(flush, 60_000);
  const b = setInterval(remind, 60 * 60_000);
  // Deadlines are measured in minutes, so this runs more often than the daily-ish reminders.
  const c = setInterval(sweep, 5 * 60_000);
  return {
    close: async () => {
      clearInterval(a);
      clearInterval(b);
      clearInterval(c);
    },
  };
}
