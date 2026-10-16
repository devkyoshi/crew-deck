import type { SidebarSectionDTO } from '@crew-deck/shared';
import { AppError, notFound } from '../lib/errors.js';
import type { Actor } from '../permissions/can.js';
import type { MessagingCtx } from './context.js';

const MAX_SECTIONS = 20;

/** A person's own sidebar groups (a layer over their channels; nobody else sees them). */
const dto = (s: { id: string; name: string; position: number }): SidebarSectionDTO => ({
  id: s.id,
  name: s.name,
  position: s.position,
});

export async function listSections(ctx: MessagingCtx, actor: Actor) {
  const rows = await ctx.db
    .tenant(actor.orgId)
    .sidebarSections.find({ userId: actor.userId }, { sort: { position: 1 } });
  return rows.map(dto);
}

export async function createSection(ctx: MessagingCtx, actor: Actor, name: string) {
  const t = ctx.db.tenant(actor.orgId);
  const existing = await t.sidebarSections.find(
    { userId: actor.userId },
    { sort: { position: -1 } },
  );
  if (existing.length >= MAX_SECTIONS)
    throw new AppError(422, 'too_many_sections', `You can have up to ${MAX_SECTIONS} sections`);
  const row = await t.sidebarSections.insert({
    userId: actor.userId,
    name,
    position: (existing[0]?.position ?? -1) + 1,
  });
  return dto(row);
}

export async function renameSection(ctx: MessagingCtx, actor: Actor, id: string, name: string) {
  const t = ctx.db.tenant(actor.orgId);
  if ((await t.sidebarSections.updateOne({ id, userId: actor.userId }, { name })) === 0)
    throw notFound('Section');
  return dto((await t.sidebarSections.get(id))!);
}

/** Deleting a section puts its channels back in the main lists. */
export async function deleteSection(ctx: MessagingCtx, actor: Actor, id: string) {
  const t = ctx.db.tenant(actor.orgId);
  if ((await t.sidebarSections.deleteOne({ id, userId: actor.userId })) === 0)
    throw notFound('Section');
  await t.channelMembers.updateMany({ userId: actor.userId, sectionId: id }, { sectionId: null });
}

/**
 * Saves the order of my sections and which section each channel is in, in one call. Only my own
 * sections and channels I am in are accepted.
 */
export async function saveOrder(
  ctx: MessagingCtx,
  actor: Actor,
  input: { sections?: string[]; assign?: Record<string, string | null> },
) {
  const t = ctx.db.tenant(actor.orgId);
  const mine = new Set((await t.sidebarSections.find({ userId: actor.userId })).map((s) => s.id));
  if (input.sections) {
    if (input.sections.some((id) => !mine.has(id))) throw notFound('Section');
    for (const [position, id] of input.sections.entries()) {
      await t.sidebarSections.updateOne({ id, userId: actor.userId }, { position });
    }
  }
  for (const [channelId, sectionId] of Object.entries(input.assign ?? {})) {
    if (sectionId !== null && !mine.has(sectionId)) throw notFound('Section');
    await t.channelMembers.updateOne({ channelId, userId: actor.userId }, { sectionId });
  }
  return listSections(ctx, actor);
}

/** True when `sectionId` is one of mine (used when a channel's own settings name a section). */
export async function ownsSection(ctx: MessagingCtx, actor: Actor, sectionId: string) {
  return ctx.db.tenant(actor.orgId).sidebarSections.exists({ id: sectionId, userId: actor.userId });
}
