import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { LINK_TYPES, type LinkType } from '@crew-deck/shared';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, withTenantTx, type TenantDb } from '../db/client.js';
import type { CommentDoc, UserDoc } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { can, type Actor } from '../permissions/can.js';
import { addWatchers, recordActivity } from '../work/activity.js';
import { refreshSearchText } from '../work/search-text.js';
import { deliverSafely, type NotifyEvent } from '../work/notify.js';
import { markFirstResponse } from '../work/sla.js';
import { sanitizeDoc } from '../work/rich-text.js';
import {
  assertMentionable,
  assertWritable,
  hydrateItems,
  resolveItem,
  type SpaceRow,
} from '../work/service.js';
import { resolveSpace, spaceCtx } from './spaces.js';

const idParam = z.object({ id: z.string().min(1).max(64) });
const uuidParam = z.object({ id: z.string().uuid() });
const pageQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** How each link reads from either end. */
const LINK_LABELS: Record<LinkType, { outward: string; inward: string }> = {
  blocks: { outward: 'blocks', inward: 'is blocked by' },
  relates_to: { outward: 'relates to', inward: 'relates to' },
  duplicates: { outward: 'duplicates', inward: 'is duplicated by' },
};

type Person = { id: string; name: string | null; email: string; avatarUrl: string | null };
const person = (u: UserDoc | undefined): Person | null =>
  u ? { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl } : null;

/** Cursor over (createdAt, id). */
const encode = (d: Date, id: string) => Buffer.from(JSON.stringify([d.toISOString(), id])).toString('base64url');
function decode(cursor: string): [Date, string] {
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string') {
      const d = new Date(v[0]);
      if (!Number.isNaN(d.getTime())) return [d, v[1]];
    }
  } catch {
    // fall through
  }
  throw new AppError(400, 'bad_cursor', 'That page marker is not valid');
}

export async function workDepthRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  const commentPermissions = (actor: Actor, space: SpaceRow, c: CommentDoc) => {
    const ctx = { ...spaceCtx(space), isAuthor: c.authorId === actor.userId };
    const writable = space.status === 'active' && !c.deletedAt;
    return {
      edit: writable && can(actor, 'comment.editOwn', ctx),
      delete: writable && (can(actor, 'comment.editOwn', ctx) || can(actor, 'comment.deleteAny', ctx)),
    };
  };

  async function presentComments(t: TenantDb, actor: Actor, space: SpaceRow, rows: CommentDoc[]) {
    const people = await t.users(rows.map((c) => c.authorId));
    return rows.map((c) => ({
      id: c.id,
      itemId: c.itemId,
      author: person(people.get(c.authorId)),
      body: c.deletedAt ? null : c.body,
      deleted: c.deletedAt !== null,
      editedAt: c.editedAt,
      createdAt: c.createdAt,
      permissions: commentPermissions(actor, space, c),
    }));
  }

  /** A comment and its item, provided the caller can see the item. Anything else is a 404. */
  async function resolveComment(t: TenantDb, actor: Actor, id: string) {
    const comment = await t.comments.get(id);
    if (!comment) throw notFound('Comment');
    const { row, space } = await resolveItem(t, actor, comment.itemId).catch(() => {
      throw notFound('Comment');
    });
    return { comment, row, space };
  }

  // ---- Comments -----------------------------------------------------------------------------------------

  r.get(
    '/items/:id/comments',
    { preHandler: requireAuth, schema: { params: idParam, querystring: pageQuery } },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (t) => {
        const { row, space } = await resolveItem(t, actor, req.params.id);
        const filter: Record<string, unknown> = { itemId: row.id };
        if (req.query.cursor) {
          const [at, id] = decode(req.query.cursor);
          filter.$or = [{ createdAt: { $gt: at } }, { createdAt: at, id: { $gt: id } }];
        }
        // Oldest first, like a conversation.
        const rows = await t.comments.find(filter, { sort: { createdAt: 1, id: 1 }, limit: req.query.limit + 1 });
        const page = rows.slice(0, req.query.limit);
        const last = page.at(-1);
        return {
          items: await presentComments(t, actor, space, page),
          nextCursor: rows.length > req.query.limit && last ? encode(last.createdAt, last.id) : null,
          permissions: {
            create: space.status === 'active' && can(actor, 'comment.create', spaceCtx(space)),
          },
        };
      });
    },
  );

  r.post(
    '/items/:id/comments',
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { params: idParam, body: z.object({ body: z.unknown() }) },
    },
    async (req) => {
      const actor = actorOf(req);
      const clean = sanitizeDoc(req.body.body);
      if (!clean.doc) {
        throw new AppError(422, 'validation_error', 'Write a comment first', { body: 'Write a comment first' });
      }
      const events: NotifyEvent[] = [];
      const result = await withTenantTx(deps.db, actor.orgId, async (t) => {
        events.length = 0;
        const { row, space } = await resolveItem(t, actor, req.params.id);
        // The person who raised a ticket can always follow up on it, even without member rights.
        const ownTicket =
          row.type === 'ticket' && row.reporterId === actor.userId && can(actor, 'ticket.submit', spaceCtx(space));
        if (!ownTicket && !can(actor, 'comment.create', spaceCtx(space))) throw forbidden();
        assertWritable(space);
        await assertMentionable(t, space, clean.mentions);
        const created = await t.comments.insert({
          spaceId: space.id,
          itemId: row.id,
          authorId: actor.userId,
          body: clean.doc,
          mentions: clean.mentions,
          editedAt: null,
          deletedAt: null,
          createdAt: new Date(),
        });
        await refreshSearchText(t, row.id);
        await markFirstResponse(t, row, actor.userId);
        await addWatchers(t, row.id, [actor.userId, ...clean.mentions]);
        await recordActivity(t, {
          item: row,
          actorId: actor.userId,
          kind: 'commented',
          newValue: { commentId: created.id, excerpt: clean.text.slice(0, 280) },
        });
        const base = { orgId: actor.orgId, actorId: actor.userId, itemId: row.id };
        const excerpt = clean.text.slice(0, 200);
        if (clean.mentions.length) events.push({ type: 'mentioned', ...base, userIds: clean.mentions, excerpt });
        // Watchers hear about the comment; people mentioned in it already get the mention instead.
        events.push({ type: 'commented', ...base, excerpt, skip: clean.mentions });
        const [out] = await presentComments(t, actor, space, [created]);
        return out!;
      });
      await deliverSafely(deps.db, events, req.log);
      return result;
    },
  );

  r.patch(
    '/comments/:id',
    { preHandler: requireAuth, schema: { params: uuidParam, body: z.object({ body: z.unknown() }) } },
    async (req) => {
      const actor = actorOf(req);
      const clean = sanitizeDoc(req.body.body);
      if (!clean.doc) {
        throw new AppError(422, 'validation_error', 'Write a comment first', { body: 'Write a comment first' });
      }
      const events: NotifyEvent[] = [];
      const result = await withTenantTx(deps.db, actor.orgId, async (t) => {
        events.length = 0;
        const { comment, row, space } = await resolveComment(t, actor, req.params.id);
        if (comment.deletedAt) throw notFound('Comment');
        if (!can(actor, 'comment.editOwn', { ...spaceCtx(space), isAuthor: comment.authorId === actor.userId })) {
          throw forbidden('You can only edit your own comments');
        }
        assertWritable(space);
        const added = clean.mentions.filter((m) => !comment.mentions.includes(m));
        await assertMentionable(t, space, added);
        const updated = await t.comments.findOneAndUpdate(
          { id: comment.id, deletedAt: null },
          { body: clean.doc, mentions: clean.mentions, editedAt: new Date() },
        );
        if (!updated) throw notFound('Comment');
        await refreshSearchText(t, row.id);
        await addWatchers(t, row.id, added);
        if (added.length) {
          events.push({ type: 'mentioned', orgId: actor.orgId, actorId: actor.userId, itemId: row.id, userIds: added, excerpt: clean.text.slice(0, 200) });
        }
        const [out] = await presentComments(t, actor, space, [updated]);
        return out!;
      });
      await deliverSafely(deps.db, events, req.log);
      return result;
    },
  );

  r.delete('/comments/:id', { preHandler: requireAuth, schema: { params: uuidParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenantTx(deps.db, actor.orgId, async (t) => {
      const { comment, row, space } = await resolveComment(t, actor, req.params.id);
      if (comment.deletedAt) throw notFound('Comment');
      const ctx = { ...spaceCtx(space), isAuthor: comment.authorId === actor.userId };
      if (!can(actor, 'comment.editOwn', ctx) && !can(actor, 'comment.deleteAny', ctx)) throw forbidden();
      assertWritable(space);
      // The comment stays as a "deleted" marker so the conversation still reads in order.
      await t.comments.updateOne({ id: comment.id }, { deletedAt: new Date(), body: null, mentions: [] });
      await refreshSearchText(t, row.id);
      await recordActivity(t, {
        item: row,
        actorId: actor.userId,
        kind: 'comment_deleted',
        oldValue: { commentId: comment.id, authorId: comment.authorId },
      });
      return { ok: true };
    });
  });

  // ---- Watchers -----------------------------------------------------------------------------------------

  r.get('/items/:id/watchers', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const { row } = await resolveItem(t, actor, req.params.id);
      const rows = await t.watchers.find({ itemId: row.id }, { sort: { createdAt: 1 } });
      const people = await t.users(rows.map((w) => w.userId));
      return {
        watching: rows.some((w) => w.userId === actor.userId),
        items: rows.flatMap((w) => {
          const p = person(people.get(w.userId));
          return p ? [p] : [];
        }),
      };
    });
  });

  r.put('/items/:id/watch', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const { row, space } = await resolveItem(t, actor, req.params.id);
      if (!can(actor, 'item.watch', spaceCtx(space))) throw forbidden();
      await addWatchers(t, row.id, [actor.userId]);
      return { watching: true };
    });
  });

  r.delete('/items/:id/watch', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const { row } = await resolveItem(t, actor, req.params.id);
      await t.watchers.deleteOne({ itemId: row.id, userId: actor.userId });
      return { watching: false };
    });
  });

  // ---- Links --------------------------------------------------------------------------------------------

  r.get('/items/:id/links', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const { row, space } = await resolveItem(t, actor, req.params.id);
      const links = await t.workItemLinks.find(
        { $or: [{ fromItemId: row.id }, { toItemId: row.id }] },
        { sort: { createdAt: 1 } },
      );
      const otherIds = links.map((l) => (l.fromItemId === row.id ? l.toItemId : l.fromItemId));
      const others = await t.workItems.find({ id: { $in: otherIds }, deletedAt: null });
      const rows = new Map((await hydrateItems(t, others)).map((i) => [i.id, i]));
      // Linked items in spaces the caller cannot open are left out, not shown as stubs.
      const spaceIds = [...new Set(others.map((o) => o.spaceId))];
      const visible = new Map<string, string>();
      for (const sid of spaceIds) {
        const v = await resolveSpace(t, actor, sid).catch(() => null);
        if (v) visible.set(sid, v.key);
      }
      const canLink = space.status === 'active' && can(actor, 'item.link', spaceCtx(space));
      return {
        items: links.flatMap((l) => {
          const outward = l.fromItemId === row.id;
          const other = rows.get(outward ? l.toItemId : l.fromItemId);
          const key = other ? visible.get(other.spaceId) : undefined;
          if (!other || !key) return [];
          return [
            {
              id: l.id,
              linkType: l.linkType,
              direction: outward ? 'outward' : 'inward',
              label: LINK_LABELS[l.linkType][outward ? 'outward' : 'inward'],
              item: {
                id: other.id,
                key: `${key}-${other.number}`,
                title: other.title,
                type: other.type,
                status: { id: other.statusId, name: other.statusName, category: other.statusCategory, color: other.statusColor },
              },
            },
          ];
        }),
        permissions: { create: canLink, delete: canLink },
      };
    });
  });

  r.post(
    '/items/:id/links',
    {
      preHandler: requireAuth,
      schema: {
        params: idParam,
        body: z.object({ target: z.string().min(1).max(64), linkType: z.enum(LINK_TYPES) }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const { linkType } = req.body;
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const { row, space } = await resolveItem(t, actor, req.params.id);
        if (!can(actor, 'item.link', spaceCtx(space))) throw forbidden();
        assertWritable(space);
        const target = await resolveItem(t, actor, req.body.target).catch(() => {
          throw new AppError(422, 'invalid_target', 'That item does not exist or you cannot open it', {
            target: 'Choose an item you can open',
          });
        });
        if (target.row.id === row.id) {
          throw new AppError(422, 'invalid_target', 'An item cannot be linked to itself', {
            target: 'Choose a different item',
          });
        }
        // "Relates to" reads the same both ways, so either direction counts as the same link.
        const same = [{ fromItemId: row.id, toItemId: target.row.id, linkType }];
        if (linkType === 'relates_to') same.push({ fromItemId: target.row.id, toItemId: row.id, linkType });
        if (await t.workItemLinks.exists({ $or: same })) {
          throw new AppError(409, 'link_exists', 'Those items are already linked that way');
        }
        const link = await t.workItemLinks.insert({
          fromItemId: row.id,
          toItemId: target.row.id,
          linkType,
          createdBy: actor.userId,
          createdAt: new Date(),
        });
        const fromKey = `${space.key}-${row.number}`;
        const toKey = `${target.space.key}-${target.row.number}`;
        await recordActivity(t, [
          { item: row, actorId: actor.userId, kind: 'linked', newValue: { linkType, label: LINK_LABELS[linkType].outward, key: toKey, itemId: target.row.id } },
          { item: target.row, actorId: actor.userId, kind: 'linked', newValue: { linkType, label: LINK_LABELS[linkType].inward, key: fromKey, itemId: row.id } },
        ]);
        return { id: link.id, linkType, fromItemId: row.id, toItemId: target.row.id };
      });
    },
  );

  r.delete('/links/:id', { preHandler: requireAuth, schema: { params: uuidParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenantTx(deps.db, actor.orgId, async (t) => {
      const link = await t.workItemLinks.get(req.params.id);
      if (!link) throw notFound('Link');
      // Either end may remove the link, if the caller can change that end.
      let allowed: Awaited<ReturnType<typeof resolveItem>> | null = null;
      let seen = false;
      for (const end of [link.fromItemId, link.toItemId]) {
        const hit = await resolveItem(t, actor, end).catch(() => null);
        if (!hit) continue;
        seen = true;
        if (hit.space.status === 'active' && can(actor, 'item.link', spaceCtx(hit.space))) {
          allowed = hit;
          break;
        }
      }
      if (!seen) throw notFound('Link');
      if (!allowed) throw forbidden();
      await t.workItemLinks.deleteOne({ id: link.id });
      const ends = await t.workItems.find(
        { id: { $in: [link.fromItemId, link.toItemId] } },
        { projection: { id: 1, spaceId: 1, number: 1 } },
      );
      const events = ends.map((e) => {
        const otherId = e.id === link.fromItemId ? link.toItemId : link.fromItemId;
        const outward = e.id === link.fromItemId;
        return {
          item: e,
          actorId: actor.userId,
          kind: 'unlinked' as const,
          oldValue: { linkType: link.linkType, label: LINK_LABELS[link.linkType][outward ? 'outward' : 'inward'], itemId: otherId },
        };
      });
      await recordActivity(t, events);
      return { ok: true };
    });
  });

  // ---- Activity -----------------------------------------------------------------------------------------

  r.get(
    '/items/:id/activity',
    { preHandler: requireAuth, schema: { params: idParam, querystring: pageQuery } },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (t) => {
        const { row } = await resolveItem(t, actor, req.params.id);
        const filter: Record<string, unknown> = { itemId: row.id };
        if (req.query.cursor) {
          const [at, id] = decode(req.query.cursor);
          filter.$or = [{ createdAt: { $lt: at } }, { createdAt: at, id: { $lt: id } }];
        }
        // Newest first.
        const rows = await t.activityEvents.find(filter, {
          sort: { createdAt: -1, id: -1 },
          limit: req.query.limit + 1,
        });
        const page = rows.slice(0, req.query.limit);
        const people = await t.users(page.map((e) => e.actorId));
        const last = page.at(-1);
        return {
          items: page.map((e) => ({
            id: e.id,
            kind: e.kind,
            field: e.field,
            oldValue: e.oldValue,
            newValue: e.newValue,
            actor: person(people.get(e.actorId)),
            createdAt: e.createdAt,
          })),
          nextCursor: rows.length > req.query.limit && last ? encode(last.createdAt, last.id) : null,
        };
      });
    },
  );
}

