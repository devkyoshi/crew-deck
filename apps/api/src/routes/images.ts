import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { writeAudit } from '../audit/service.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { findOrgBySlug, loadAuthUser } from '../auth/service.js';
import { withTenant, withTenantTx } from '../db/client.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { assertFeature, loadPlan } from '../plans/index.js';
import { can } from '../permissions/can.js';
import type { StorageDriver } from '../storage/index.js';

/** Profile photos and workspace logos are small images, far below the attachment limit. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
} as const;
type Ext = keyof typeof TYPES;

/** What the first bytes say the file is (the browser's claim and the file name are not trusted). */
export function sniffImage(head: Buffer): Ext | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg';
  if (head.length >= 12 && head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP')
    return 'webp';
  return null;
}

/** Storage keys are four ids; these images use <org>/<owner>/<file>/<file> so no new field is needed. */
const keyFor = (orgId: string, ownerId: string, fileId: string) => `${orgId}/${ownerId}/${fileId}/${fileId}`;

const fileParam = z.object({ file: z.string().regex(/^[0-9a-f-]{36}\.(png|jpg|webp)$/) });

async function receiveImage(req: FastifyRequest, storage: StorageDriver, key: string): Promise<Ext> {
  if (!req.isMultipart()) {
    throw new AppError(415, 'unsupported_media_type', 'Send the picture as multipart/form-data');
  }
  const file = await req.file({ limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });
  if (!file) throw new AppError(422, 'validation_error', 'Choose a picture', { file: 'Choose a picture' });
  let head = Buffer.alloc(0);
  const tap = new Transform({
    transform(chunk: Buffer, _enc, done) {
      if (head.length < 16) head = Buffer.concat([head, chunk]).subarray(0, 16);
      done(null, chunk);
    },
  });
  const fail = async (e: AppError) => {
    await storage.delete(key);
    return e;
  };
  let size = 0;
  try {
    size = await storage.put(key, file.file, tap);
  } catch (e) {
    if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE' || file.file.truncated) {
      throw await fail(new AppError(413, 'payload_too_large', 'Pictures can be up to 2 MB', { file: 'Pictures can be up to 2 MB' }));
    }
    throw e;
  }
  if (file.file.truncated) {
    throw await fail(new AppError(413, 'payload_too_large', 'Pictures can be up to 2 MB', { file: 'Pictures can be up to 2 MB' }));
  }
  const ext = size > 0 ? sniffImage(head) : null;
  if (!ext) {
    throw await fail(
      new AppError(415, 'file_type_blocked', 'Use a PNG, JPG or WebP picture', { file: 'Use a PNG, JPG or WebP picture' }),
    );
  }
  return ext;
}

export async function imageRoutes(app: FastifyInstance, deps: AuthDeps & { storage: StorageDriver }) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();
  const uploadLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

  const serve = (ext: Ext, key: string, reply: import('fastify').FastifyReply) =>
    reply
      .header('content-type', TYPES[ext])
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .send(deps.storage.get(key));

  // ---- Profile photo ----------------------------------------------------------------------------------

  r.post('/me/avatar', { preHandler: requireAuth, config: uploadLimit }, async (req) => {
    const user = req.user!;
    const orgId = req.org!.id;
    const fileId = randomUUID();
    const key = keyFor(orgId, user.id, fileId);
    const ext = await receiveImage(req, deps.storage, key);
    const previous = user.avatarUrl;
    const url = `/api/v1/avatars/${user.id}/${fileId}.${ext}`;
    await withTenant(deps.db, orgId, (t) => t.updateUser(user.id, { avatarUrl: url }));
    // The old picture is only deleted once the new one is saved.
    const old = previous?.match(/\/avatars\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(?:png|jpg|webp)$/);
    if (old && old[1] === user.id) await deps.storage.delete(keyFor(orgId, user.id, old[2]!));
    req.user = (await loadAuthUser(deps.db, orgId, user.id)) ?? user;
    return { avatarUrl: url };
  });

  r.delete('/me/avatar', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.user!;
    const orgId = req.org!.id;
    const old = user.avatarUrl?.match(/\/avatars\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(?:png|jpg|webp)$/);
    await withTenant(deps.db, orgId, (t) => t.updateUser(user.id, { avatarUrl: null }));
    if (old && old[1] === user.id) await deps.storage.delete(keyFor(orgId, user.id, old[2]!));
    return reply.code(204).send();
  });

  // Anyone signed in to the workspace can see a teammate's photo.
  r.get(
    '/avatars/:userId/:file',
    {
      preHandler: requireAuth,
      schema: { params: z.object({ userId: z.string().regex(/^[0-9a-f-]{36}$/) }).merge(fileParam) },
    },
    async (req, reply) => {
      const [id, ext] = req.params.file.split('.') as [string, Ext];
      return serve(ext, keyFor(req.org!.id, req.params.userId, id), reply);
    },
  );

  // ---- Workspace logo ---------------------------------------------------------------------------------

  r.post('/org/logo', { preHandler: requireAuth, config: uploadLimit }, async (req) => {
    const actor = actorOf(req);
    if (!can(actor, 'settings.manage')) throw forbidden();
    await withTenant(deps.db, actor.orgId, async (t) =>
      assertFeature(await loadPlan(t, actor.orgId), 'branding_full', 'Logo and accent colour'),
    );
    const fileId = randomUUID();
    const key = keyFor(actor.orgId, actor.orgId, fileId);
    const ext = await receiveImage(req, deps.storage, key);
    const url = `/api/v1/org-logo/${fileId}.${ext}`;
    const before = await withTenantTx(deps.db, actor.orgId, async (tx) => {
      const org = await tx.organization();
      await tx.updateBranding({ logoUrl: url });
      await writeAudit(tx, {
        orgId: actor.orgId,
        actorId: actor.userId,
        action: 'settings.branding_updated',
        targetType: 'settings',
        targetId: actor.orgId,
        before: { logoUrl: org?.logoUrl ?? null },
        after: { logoUrl: url },
      });
      return org?.logoUrl ?? null;
    });
    const old = before?.match(/\/org-logo\/([0-9a-f-]{36})\.(?:png|jpg|webp)$/);
    if (old) await deps.storage.delete(keyFor(actor.orgId, actor.orgId, old[1]!));
    return { logoUrl: url };
  });

  // The logo also appears on screens before sign-in (the workspace's own address), so it is not behind a login.
  r.get('/org-logo/:file', { schema: { params: fileParam } }, async (req, reply) => {
    if (!req.tenantSlug) throw notFound('Logo');
    const org = await findOrgBySlug(deps.db, req.tenantSlug);
    if (!org) throw notFound('Logo');
    const [id, ext] = req.params.file.split('.') as [string, Ext];
    return serve(ext, keyFor(org.id, org.id, id), reply);
  });
}
