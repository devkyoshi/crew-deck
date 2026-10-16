import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { findOrgBySlug } from '../auth/service.js';
import { storageSecret } from '../config.js';
import { withTenant, withTenantTx, type TenantDb } from '../db/client.js';
import type { AttachmentDoc } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { can, type Actor } from '../permissions/can.js';
import { assertWithinLimit, loadPlan, storageBytes } from '../plans/index.js';
import {
  signFileUrl,
  verifyFileSignature,
  type StorageDriver,
} from '../storage/index.js';
import { receiveUpload, MAX_UPLOAD_BYTES } from '../storage/receive.js';
import { recordActivity } from '../work/activity.js';
import { refreshSearchText } from '../work/search-text.js';
import { assertWritable, resolveItem, type SpaceRow } from '../work/service.js';
import { spaceCtx } from './spaces.js';

export interface AttachmentDeps extends AuthDeps {
  storage: StorageDriver;
}

const MB = 1024 * 1024;
export { MAX_UPLOAD_BYTES };

const idParam = z.object({ id: z.string().min(1).max(64) });
const uuidParam = z.object({ id: z.string().uuid() });

export async function attachmentRoutes(app: FastifyInstance, deps: AttachmentDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();
  const secret = storageSecret(deps.config);

  const present = async (t: TenantDb, actor: Actor, space: SpaceRow, rows: AttachmentDoc[]) => {
    const people = await t.users(rows.map((a) => a.uploaderId));
    return rows.map((a) => {
      const u = people.get(a.uploaderId);
      return {
        id: a.id,
        itemId: a.itemId,
        name: a.name,
        mime: a.mime,
        size: a.size,
        isImage: a.image !== null,
        uploader: u ? { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl } : null,
        createdAt: a.createdAt,
        url: signFileUrl(secret, { attachmentId: a.id, orgId: actor.orgId }),
        permissions: {
          delete:
            space.status === 'active' &&
            can(actor, 'attachment.delete', { ...spaceCtx(space), isAuthor: a.uploaderId === actor.userId }),
        },
      };
    });
  };

  // ---- List -----------------------------------------------------------------------------------------------

  r.get('/items/:id/attachments', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const { row, space } = await resolveItem(t, actor, req.params.id);
      const rows = await t.attachments.find({ itemId: row.id }, { sort: { createdAt: 1, id: 1 } });
      const plan = await loadPlan(t, actor.orgId);
      return {
        items: await present(t, actor, space, rows),
        permissions: {
          add: space.status === 'active' && can(actor, 'attachment.add', spaceCtx(space)),
        },
        maxFileMb: plan.limits.max_attachment_mb ?? MAX_UPLOAD_BYTES / MB,
      };
    });
  });

  // ---- Upload ---------------------------------------------------------------------------------------------

  const uploadLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };
  r.post('/items/:id/attachments', { preHandler: requireAuth, config: uploadLimit, schema: { params: idParam } }, async (req, reply) => {
    const actor = actorOf(req);
    if (!req.isMultipart()) {
      throw new AppError(415, 'unsupported_media_type', 'Send the file as multipart/form-data');
    }

    // Permission and limits first, outside a transaction (the upload itself can take a while).
    const pre = await withTenant(deps.db, actor.orgId, async (t) => {
      const { row, space } = await resolveItem(t, actor, req.params.id);
      if (!can(actor, 'attachment.add', spaceCtx(space))) throw forbidden();
      assertWritable(space);
      const plan = await loadPlan(t, actor.orgId);
      const used = await storageBytes(t);
      const storageMb = plan.limits.storage_mb;
      if (storageMb !== undefined && used >= storageMb * MB) assertWithinLimit(plan, 'storage_mb', storageMb, 1);
      return { row, space, plan, used };
    });

    const key = `${actor.orgId}/${pre.space.id}/${pre.row.id}/${randomUUID()}`;
    const got = await receiveUpload(req, deps.storage, key, pre.plan, pre.used);
    const { name, size } = got;

    try {
      const out = await withTenantTx(deps.db, actor.orgId, async (t) => {
        // The item may have been deleted while the file was uploading.
        const { row, space } = await resolveItem(t, actor, pre.row.id);
        assertWritable(space);
        const created = await t.attachments.insert({
          spaceId: space.id,
          itemId: row.id,
          uploaderId: actor.userId,
          name,
          mime: got.mime,
          image: got.image,
          size,
          storageKey: key,
          createdAt: new Date(),
        });
        await refreshSearchText(t, row.id);
        await recordActivity(t, {
          item: row,
          actorId: actor.userId,
          kind: 'attachment_added',
          newValue: { attachmentId: created.id, name, size },
        });
        const [p] = await present(t, actor, space, [created]);
        return p!;
      });
      return reply.send(out);
    } catch (e) {
      await deps.storage.delete(key);
      throw e;
    }
  });

  // ---- Link and delete ------------------------------------------------------------------------------------

  async function resolveAttachment(t: TenantDb, actor: Actor, id: string) {
    const a = await t.attachments.get(id);
    if (!a) throw notFound('Attachment');
    const hit = await resolveItem(t, actor, a.itemId).catch(() => {
      throw notFound('Attachment');
    });
    return { a, ...hit };
  }

  r.get('/attachments/:id', { preHandler: requireAuth, schema: { params: uuidParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const { a, space } = await resolveAttachment(t, actor, req.params.id);
      const [p] = await present(t, actor, space, [a]);
      return p!;
    });
  });

  r.delete('/attachments/:id', { preHandler: requireAuth, schema: { params: uuidParam } }, async (req) => {
    const actor = actorOf(req);
    const key = await withTenantTx(deps.db, actor.orgId, async (t) => {
      const { a, row, space } = await resolveAttachment(t, actor, req.params.id);
      if (!can(actor, 'attachment.delete', { ...spaceCtx(space), isAuthor: a.uploaderId === actor.userId })) {
        throw forbidden();
      }
      assertWritable(space);
      await t.attachments.deleteOne({ id: a.id });
      await refreshSearchText(t, row.id);
      await recordActivity(t, {
        item: row,
        actorId: actor.userId,
        kind: 'attachment_removed',
        oldValue: { attachmentId: a.id, name: a.name },
      });
      return a.storageKey;
    });
    // The record is gone; the bytes follow once the transaction has committed.
    await deps.storage.delete(key);
    return { ok: true };
  });

  // ---- Serving ----------------------------------------------------------------------------------------------

  /**
   * Serves a file from a signed link. The link is the permission (it was handed out after a check), so
   * no session is needed, but it only works on its own workspace's address and only until it expires.
   */
  r.get(
    '/files/:id',
    {
      schema: {
        params: uuidParam,
        querystring: z.object({ e: z.coerce.number().int(), s: z.string().min(10).max(100) }),
      },
    },
    async (req, reply) => {
      if (!req.tenantSlug) throw notFound('File');
      const org = await findOrgBySlug(deps.db, req.tenantSlug);
      const claims = { attachmentId: req.params.id, ...req.query };
      if (!org || !verifyFileSignature(secret, { ...claims, orgId: org.id })) throw notFound('File');
      // Files of work items and files in a space's document library are served the same way.
      const t = deps.db.tenant(org.id);
      const a = (await t.attachments.get(req.params.id)) ?? (await t.spaceFiles.get(req.params.id));
      if (!a) throw notFound('File');
      const inline = a.image !== null;
      const encoded = encodeURIComponent(a.name).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
      const ascii = a.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
      reply
        .header('content-type', inline ? a.image! : 'application/octet-stream')
        .header('content-length', String(a.size))
        .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`)
        .header('cache-control', 'private, max-age=600');
      return reply.send(deps.storage.get(a.storageKey));
    },
  );
}
