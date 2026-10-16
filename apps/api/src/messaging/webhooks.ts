import { createHash, randomBytes } from 'node:crypto';
import {
  MAX_WEBHOOKS_PER_CHANNEL,
  MAX_WEBHOOK_TEXT_CHARS,
  type WebhookDTO,
} from '@crew-deck/shared';
import { writeAudit } from '../audit/service.js';
import type { IncomingWebhookDoc } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { can, type Actor } from '../permissions/can.js';
import { loadChannel } from './access.js';
import { postAsBot } from './bot.js';
import type { MessagingCtx } from './context.js';
import { peopleOf } from './dto.js';

/** Webhook bots carry the webhook's id, so the name shown always follows the webhook. */
export const webhookBotId = (id: string): `wh:${string}` => `wh:${id}`;

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => `whk_${randomBytes(32).toString('base64url')}`;

async function present(
  ctx: MessagingCtx,
  orgId: string,
  rows: IncomingWebhookDoc[],
): Promise<WebhookDTO[]> {
  const people = await peopleOf(
    ctx.db.tenant(orgId),
    rows.map((r) => r.createdBy),
  );
  return rows.map((r) => ({
    id: r.id,
    channelId: r.channelId,
    name: r.name,
    createdAt: r.createdAt.toISOString(),
    createdBy: people.get(r.createdBy)
      ? { id: r.createdBy, name: people.get(r.createdBy)!.name }
      : null,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
  }));
}

/** Workspace owners and admins manage webhooks, for channels they can see (never a direct message). */
async function manageable(ctx: MessagingCtx, actor: Actor, channelId: string) {
  if (!can(actor, 'webhook.manage')) throw forbidden();
  const t = ctx.db.tenant(actor.orgId);
  const { channel } = await loadChannel(t, actor, channelId);
  if (channel.type === 'dm' || channel.type === 'group_dm')
    throw new AppError(409, 'dm_fixed', 'Webhooks post into channels, not direct messages');
  return { t, channel };
}

/**
 * Makes a secret address that posts into a channel. The secret is shown once, here, and only its hash is
 * kept: nobody (including the workspace) can read it again, only revoke it and make another.
 */
export async function createWebhook(
  ctx: MessagingCtx,
  actor: Actor,
  channelId: string,
  name: string,
): Promise<{ webhook: WebhookDTO; token: string }> {
  const { t, channel } = await manageable(ctx, actor, channelId);
  if (channel.isArchived) throw new AppError(409, 'channel_archived', 'This channel is archived and read-only');
  if ((await t.incomingWebhooks.count({ channelId, revokedAt: null })) >= MAX_WEBHOOKS_PER_CHANNEL)
    throw new AppError(409, 'too_many_webhooks', `A channel can have up to ${MAX_WEBHOOKS_PER_CHANNEL} webhooks`);
  const token = newToken();
  const row = await ctx.db.tx(actor.orgId, async (tx) => {
    const created = await tx.incomingWebhooks.insert({
      channelId,
      name: name.trim(),
      tokenHash: hashOf(token),
      createdBy: actor.userId,
    });
    await writeAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      action: 'webhook.created',
      targetType: 'channel',
      targetId: channelId,
      after: { webhookId: created.id, name: created.name },
    });
    return created;
  });
  return { webhook: (await present(ctx, actor.orgId, [row]))[0]!, token };
}

export async function listWebhooks(ctx: MessagingCtx, actor: Actor, channelId: string) {
  const { t } = await manageable(ctx, actor, channelId);
  const rows = await t.incomingWebhooks.find({ channelId, revokedAt: null }, { sort: { createdAt: 1 } });
  return present(ctx, actor.orgId, rows);
}

/** Revoked at once: the next post to its address is refused. */
export async function revokeWebhook(ctx: MessagingCtx, actor: Actor, webhookId: string) {
  if (!can(actor, 'webhook.manage')) throw forbidden();
  const t = ctx.db.tenant(actor.orgId);
  const hook = await t.incomingWebhooks.findOne({ id: webhookId, revokedAt: null });
  if (!hook) throw notFound('Webhook');
  await ctx.db.tx(actor.orgId, async (tx) => {
    await tx.incomingWebhooks.updateOne({ id: webhookId }, { revokedAt: new Date() });
    await writeAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      action: 'webhook.revoked',
      targetType: 'channel',
      targetId: hook.channelId,
      after: { webhookId, name: hook.name },
    });
  });
}

/**
 * A post to a webhook's address. No session: the secret in the address is the credential, looked up by its
 * hash across workspaces. Plain text only (no mentions, no formatting), limited per webhook and per
 * workspace, and refused for an archived channel. Every failure before the lookup answers the same.
 */
export async function ingestWebhook(
  ctx: MessagingCtx,
  token: string,
  body: unknown,
): Promise<{ id: string }> {
  const bad = () => new AppError(404, 'not_found', 'Not found');
  if (!/^whk_[A-Za-z0-9_-]{43}$/.test(token)) throw bad();
  const hook = await ctx.db.global.all.incomingWebhooks.findOne({
    tokenHash: hashOf(token),
    revokedAt: null,
  });
  if (!hook) throw bad();
  const text = (body as { text?: unknown } | null)?.text;
  if (typeof text !== 'string' || text.trim() === '')
    throw new AppError(422, 'validation_error', 'Send JSON like {"text": "hello"}');
  if (text.length > MAX_WEBHOOK_TEXT_CHARS)
    throw new AppError(422, 'validation_error', `The text can be up to ${MAX_WEBHOOK_TEXT_CHARS} characters`);
  await ctx.limiter?.message(hook.orgId, webhookBotId(hook.id));
  const msg = await postAsBot(ctx, hook.orgId, {
    botId: webhookBotId(hook.id),
    channelId: hook.channelId,
    text: text.trim(),
    plain: true,
  });
  if (!msg) throw new AppError(409, 'channel_archived', 'That channel is archived or no longer exists');
  await ctx.db.tenant(hook.orgId).incomingWebhooks.updateOne({ id: hook.id }, { lastUsedAt: new Date() });
  return { id: msg.id };
}
