import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
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
  cleanFileName,
  inspectFile,
  signFileUrl,
  verifyFileSignature,
  type StorageDriver,
} from '../storage/index.js';
import { recordActivity } from '../work/activity.js';
import { assertWritable, resolveItem, type SpaceRow } from '../work/service.js';
import { spaceCtx } from './spaces.js';

export interface AttachmentDeps extends AuthDeps {
  storage: StorageDriver;
}

const MB = 1024 * 1024;
/** Hard ceiling for any upload, whatever the plan says (multipart parser limit). */
export const MAX_UPLOAD_BYTES = 100 * MB;
const HEAD_BYTES = 64;

const idParam = z.object({ id: z.string().min(1).max(64) });
const uuidParam = z.object({ id: z.string().uuid() });

const tooBig = (mb: number) =>
  new AppError(413, 'file_too_large', `Files can be up to ${mb} MB on your plan`, {
    file: `Choose a file of ${mb} MB or less`,
  });

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

  r.post('/items/:id/attachments', { preHandler: requireAuth, schema: { params: idParam } }, async (req, reply) => {
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

    const fileMb = pre.plan.limits.max_attachment_mb;
    const maxBytes = Math.min(fileMb !== undefined ? fileMb * MB : MAX_UPLOAD_BYTES, MAX_UPLOAD_BYTES);
    const file = await req.file({ limits: { fileSize: maxBytes, files: 1 } });
    if (!file) throw new AppError(422, 'validation_error', 'Choose a file to upload', { file: 'Choose a file' });

    const name = cleanFileName(file.filename);
    const key = `${actor.orgId}/${pre.space.id}/${pre.row.id}/${randomUUID()}`;
    // Keep the first bytes to check what the file really is.
    let head = Buffer.alloc(0);
    const tap = new Transform({
      transform(chunk: Buffer, _enc, done) {
        if (head.length < HEAD_BYTES) head = Buffer.concat([head, chunk]).subarray(0, HEAD_BYTES);
        done(null, chunk);
      },
    });
    const discard = async (err: unknown) => {
      await deps.storage.delete(key);
      return err;
    };
    let size: number;
    try {
      size = await deps.storage.put(key, file.file, tap);
    } catch (e) {
      // The parser stops the stream at the plan's size limit.
      const limitHit = (e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE' || file.file.truncated;
      throw await discard(limitHit ? tooBig(fileMb ?? MAX_UPLOAD_BYTES / MB) : e);
    }
    if (file.file.truncated) throw await discard(tooBig(fileMb ?? MAX_UPLOAD_BYTES / MB));
    if (size === 0) {
      throw await discard(new AppError(422, 'validation_error', 'That file is empty', { file: 'That file is empty' }));
    }
    const kind = inspectFile(head, name);
    if (kind.executable) {
      throw await discard(
        new AppError(415, 'file_type_blocked', 'Programs and scripts cannot be attached', {
          file: 'Programs and scripts cannot be attached',
        }),
      );
    }
    const storageMb = pre.plan.limits.storage_mb;
    if (storageMb !== undefined && pre.used + size > storageMb * MB) {
      const err = await discard(
        new AppError(402, 'plan_limit', `The ${pre.plan.name} plan allows up to ${storageMb} MB of storage.`, {
          limit: 'storage_mb',
          plan: pre.plan.key ?? '',
        }),
      );
      throw err;
    }

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
          mime: kind.image ?? (file.mimetype || 'application/octet-stream').slice(0, 100),
          image: kind.image,
          size,
          storageKey: key,
          createdAt: new Date(),
        });
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
      const a = await deps.db.tenant(org.id).attachments.get(req.params.id);
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
