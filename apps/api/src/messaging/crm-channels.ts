import type { ChannelDTO } from '@crew-deck/shared';
import { writeAudit } from '../audit/service.js';
import { isDuplicateKey, type TenantDb } from '../db/client.js';
import type { ChannelDoc } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { assertWithinLimit, countChannels, loadPlan } from '../plans/index.js';
import { can, type Actor } from '../permissions/can.js';
import { postAsBot } from './bot.js';
import { announceMembership, memberCounts } from './channels.js';
import { runLater, type MessagingCtx } from './context.js';
import { channelDTO, peopleOf } from './dto.js';

type CrmKind = 'deal' | 'company';

const slugOf = (title: string) =>
  title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

async function recordTitle(t: TenantDb, kind: CrmKind, id: string): Promise<string | null> {
  if (kind === 'deal') return (await t.crmDeals.findOne({ id, deletedAt: null }))?.title ?? null;
  return (await t.crmCompanies.findOne({ id, deletedAt: null }))?.name ?? null;
}

const crmChannel = (t: TenantDb, kind: CrmKind, id: string) =>
  t.channels.findOne({ 'crmLink.type': kind, 'crmLink.id': id });

/**
 * "Open channel" on a deal or company: a private channel that receives its stage changes and new
 * activities. One per record; asking again returns it and, for someone who may edit CRM records, puts
 * them in it. Only people who can edit CRM records can open one (the record's content is theirs to see).
 */
export async function openCrmChannel(
  ctx: MessagingCtx,
  actor: Actor,
  kind: CrmKind,
  recordId: string,
): Promise<ChannelDTO> {
  if (!can(actor, 'crm.edit')) throw forbidden();
  const t = ctx.db.tenant(actor.orgId);
  const title = await recordTitle(t, kind, recordId);
  if (!title) throw notFound(kind === 'deal' ? 'Deal' : 'Company');

  let channel = await crmChannel(t, kind, recordId);
  if (!channel) {
    assertWithinLimit(await loadPlan(t), 'channels', await countChannels(t));
    const base = `${kind}-${slugOf(title) || 'record'}`.slice(0, 70);
    for (const name of [`${base}-${recordId.slice(0, 4)}`, `${base}-${recordId.slice(0, 8)}`]) {
      try {
        channel = await ctx.db.tx(actor.orgId, async (tx) => {
          const c = await tx.channels.insert({
            type: 'private',
            name,
            slug: name,
            topic: `CRM ${kind}: ${title}`.slice(0, 250),
            description: null,
            isAnnouncement: false,
            createdBy: actor.userId,
            crmLink: { type: kind, id: recordId },
          });
          await tx.channelMembers.insert({ channelId: c.id, userId: actor.userId, role: 'owner' });
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'channel.created',
            targetType: 'channel',
            targetId: c.id,
            after: { name: c.name, type: c.type, crm: { type: kind, id: recordId } },
          });
          return c;
        });
        announceMembership(ctx, actor.orgId, actor.userId, channel.id, 'added');
        break;
      } catch (e) {
        if (!isDuplicateKey(e)) throw e;
        channel = await crmChannel(t, kind, recordId); // another request made it first
        if (channel) break;
      }
    }
    if (!channel) throw new AppError(409, 'name_taken', 'Could not make a channel for this record');
  } else if (!(await t.channelMembers.exists({ channelId: channel.id, userId: actor.userId }))) {
    const added = await t.channelMembers.insertIgnore({ channelId: channel.id, userId: actor.userId, role: 'member' });
    if (added) {
      await t.readCursors.upsert(
        { channelId: channel.id, userId: actor.userId },
        { lastReadSeq: channel.lastSeq, lastReadAt: new Date() },
      );
      await ctx.db.tx(actor.orgId, (tx) =>
        writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'channel.member_added',
          targetType: 'channel',
          targetId: channel!.id,
          after: { userId: actor.userId, cause: { type: 'crm', kind, id: recordId } },
        }),
      );
      announceMembership(ctx, actor.orgId, actor.userId, channel.id, 'added');
    }
  }
  const counts = await memberCounts(t, [channel.id]);
  return channelDTO(channel, counts.get(channel.id) ?? 0);
}

/** The channels that should hear about a deal: its own, and its company's. */
async function channelsFor(t: TenantDb, kind: 'deal' | 'company', id: string, companyId: string | null) {
  const out: ChannelDoc[] = [];
  const own = await crmChannel(t, kind, id);
  if (own) out.push(own);
  if (kind === 'deal' && companyId) {
    const company = await crmChannel(t, 'company', companyId);
    if (company) out.push(company);
  }
  return out.filter((c) => !c.isArchived);
}

async function say(ctx: MessagingCtx, orgId: string, channels: ChannelDoc[], text: string) {
  for (const c of channels) await postAsBot(ctx, orgId, { botId: 'crm', channelId: c.id, text, plain: true });
}

/** After a deal changed stage: tell the deal's channel (and its company's). Never delays the request. */
export function announceDealMoved(
  ctx: MessagingCtx,
  orgId: string,
  e: { dealId: string; fromStage: string | null; toStage: string; status: 'open' | 'won' | 'lost'; actorId: string },
) {
  runLater(ctx, async () => {
    const t = ctx.db.tenant(orgId);
    const deal = await t.crmDeals.findOne({ id: e.dealId });
    if (!deal) return;
    const channels = await channelsFor(t, 'deal', deal.id, deal.companyId);
    if (channels.length === 0) return;
    const who = (await peopleOf(t, [e.actorId])).get(e.actorId);
    const name = who?.name ?? who?.email ?? 'Someone';
    const outcome = e.status === 'won' ? ' The deal is won.' : e.status === 'lost' ? ' The deal is lost.' : '';
    await say(
      ctx,
      orgId,
      channels,
      `${name} moved “${deal.title}” from ${e.fromStage ?? 'a previous stage'} to ${e.toStage}.${outcome}`,
    );
  });
}

/** After an activity or note was added to a deal or company. */
export function announceCrmActivity(
  ctx: MessagingCtx,
  orgId: string,
  e: { linkedType: string | null; linkedId: string | null; actorId: string; what: string },
) {
  if (!e.linkedId || (e.linkedType !== 'deal' && e.linkedType !== 'company')) return;
  const kind = e.linkedType;
  const id = e.linkedId;
  runLater(ctx, async () => {
    const t = ctx.db.tenant(orgId);
    const companyId = kind === 'deal' ? ((await t.crmDeals.findOne({ id }))?.companyId ?? null) : null;
    const channels = await channelsFor(t, kind, id, companyId);
    if (channels.length === 0) return;
    const who = (await peopleOf(t, [e.actorId])).get(e.actorId);
    await say(ctx, orgId, channels, `${who?.name ?? who?.email ?? 'Someone'} ${e.what}`);
  });
}
