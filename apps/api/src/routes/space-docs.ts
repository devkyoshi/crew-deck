import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { storageSecret } from '../config.js';
import { isDuplicateKey, withTenant, withTenantTx, type TenantDb } from '../db/client.js';
import type { SpaceFileDoc, SpaceFolderDoc } from '../db/types.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { liveTouch } from '../lib/live.js';
import { can, type Actor } from '../permissions/can.js';
import { assertWithinLimit, loadPlan, storageBytes } from '../plans/index.js';
import { cleanFileName, signFileUrl, type StorageDriver } from '../storage/index.js';
import { MAX_UPLOAD_BYTES, receiveUpload } from '../storage/receive.js';
import { assertWritable, type SpaceRow } from '../work/service.js';
import { resolveSpace, spaceCtx } from './spaces.js';

export interface SpaceDocsDeps extends AuthDeps {
  storage: StorageDriver;
}

const MB = 1024 * 1024;
const NO_ITEM = '00000000-0000-0000-0000-000000000000';
const MAX_DEPTH = 8;
const MAX_FOLDERS = 500;
const idParam = z.object({ id: z.string().min(1).max(64) });
const uuidParam = z.object({ id: z.string().uuid() });
const folderName = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(80, 'Use 80 characters or fewer')
  .refine((n) => !/[\\/]/.test(n), 'A folder name cannot contain / or \\');

const nameTaken = () =>
  new AppError(409, 'name_taken', 'A folder with that name already exists here', {
    name: 'A folder with that name already exists here',
  });

/** The space's shared document library: nested folders and uploaded files, visible to everyone who can open the space. */
export async function spaceDocRoutes(app: FastifyInstance, deps: SpaceDocsDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();
  const secret = storageSecret(deps.config);
  const uploadLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };

  const perms = (actor: Actor, space: SpaceRow, authorId?: string) => {
    const ctx = { ...spaceCtx(space), isAuthor: authorId === actor.userId };
    return {
      add: space.status === 'active' && can(actor, 'doc.add', spaceCtx(space)),
      delete: space.status === 'active' && can(actor, 'doc.delete', ctx),
    };
  };

  async function loadFolder(t: TenantDb, actor: Actor, id: string) {
    const folder = await t.spaceFolders.get(id);
    if (!folder) throw notFound('Folder');
    const space = await resolveSpace(t, actor, folder.spaceId).catch(() => {
      throw notFound('Folder');
    });
    return { folder, space };
  }
  async function loadFile(t: TenantDb, actor: Actor, id: string) {
    const file = await t.spaceFiles.get(id);
    if (!file) throw notFound('File');
    const space = await resolveSpace(t, actor, file.spaceId).catch(() => {
      throw notFound('File');
    });
    return { file, space };
  }

  /** The folder and its parents, root first. */
  async function pathOf(t: TenantDb, folder: SpaceFolderDoc) {
    const path: SpaceFolderDoc[] = [folder];
    while (path[0]!.parentId) {
      const up = await t.spaceFolders.get(path[0]!.parentId);
      if (!up || path.length > MAX_DEPTH + 1) break;
      path.unshift(up);
    }
    return path;
  }
  async function depthOf(t: TenantDb, parentId: string | null) {
    if (!parentId) return 0;
    const parent = await t.spaceFolders.get(parentId);
    return parent ? (await pathOf(t, parent)).length : 0;
  }
  /** A folder in this space, or null for the top level. */
  async function folderIn(t: TenantDb, space: SpaceRow, id: string | null | undefined) {
    if (!id) return null;
    const f = await t.spaceFolders.findOne({ id, spaceId: space.id });
    if (!f) {
      throw new AppError(422, 'invalid_folder', 'That folder does not exist in this space', { folderId: 'Choose a folder from this space' });
    }
    return f;
  }
  /** Every folder id at or below `id`. */
  async function subtreeIds(t: TenantDb, spaceId: string, id: string) {
    const all = await t.spaceFolders.find({ spaceId }, { projection: { id: 1, parentId: 1 } });
    const out = [id];
    for (let i = 0; i < out.length; i++) for (const f of all) if (f.parentId === out[i]) out.push(f.id);
    return out;
  }

  const presentFile = async (t: TenantDb, actor: Actor, space: SpaceRow, rows: SpaceFileDoc[]) => {
    const people = await t.users(rows.map((f) => f.uploaderId));
    return rows.map((f) => {
      const u = people.get(f.uploaderId);
      return {
        id: f.id,
        folderId: f.folderId,
        name: f.name,
        mime: f.mime,
        size: f.size,
        isImage: f.image !== null,
        uploader: u ? { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl } : null,
        createdAt: f.createdAt,
        url: signFileUrl(secret, { attachmentId: f.id, orgId: actor.orgId }),
        permissions: perms(actor, space, f.uploaderId),
      };
    });
  };
  const presentFolder = async (t: TenantDb, actor: Actor, space: SpaceRow, rows: SpaceFolderDoc[]) => {
    const people = await t.users(rows.map((f) => f.createdBy));
    return rows.map((f) => {
      const u = people.get(f.createdBy);
      return {
        id: f.id,
        parentId: f.parentId,
        name: f.name,
        createdBy: u ? { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl } : null,
        createdAt: f.createdAt,
        permissions: perms(actor, space, f.createdBy),
      };
    });
  };

  // ---- Browse ---------------------------------------------------------------------------------------------

  r.get(
    '/spaces/:id/documents',
    {
      preHandler: requireAuth,
      schema: { params: idParam, querystring: z.object({ folder: z.string().uuid().optional() }) },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenant(deps.db, actor.orgId, async (t) => {
        const space = await resolveSpace(t, actor, req.params.id);
        const current = req.query.folder ? await folderIn(t, space, req.query.folder).catch(() => { throw notFound('Folder'); }) : null;
        const [folders, files, plan, path] = await Promise.all([
          t.spaceFolders.find({ spaceId: space.id, parentId: current?.id ?? null }, { sort: { nameLower: 1 } }),
          t.spaceFiles.find({ spaceId: space.id, folderId: current?.id ?? null }, { sort: { createdAt: -1, id: 1 } }),
          loadPlan(t, actor.orgId),
          current ? pathOf(t, current) : Promise.resolve([] as SpaceFolderDoc[]),
        ]);
        return {
          path: path.map((f) => ({ id: f.id, name: f.name })),
          folders: await presentFolder(t, actor, space, folders),
          files: await presentFile(t, actor, space, files),
          permissions: perms(actor, space),
          maxFileMb: plan.limits.max_attachment_mb ?? MAX_UPLOAD_BYTES / MB,
        };
      });
    },
  );

  // ---- Folders --------------------------------------------------------------------------------------------

  r.post(
    '/spaces/:id/folders',
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: { params: idParam, body: z.object({ name: folderName, parentId: z.string().uuid().nullable().default(null) }) },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const space = await resolveSpace(t, actor, req.params.id);
        if (!can(actor, 'doc.add', spaceCtx(space))) throw forbidden();
        assertWritable(space);
        const parent = await folderIn(t, space, req.body.parentId);
        if ((await depthOf(t, parent?.id ?? null)) >= MAX_DEPTH) {
          throw new AppError(422, 'too_deep', `Folders can go ${MAX_DEPTH} levels deep`, { parentId: 'Choose a higher folder' });
        }
        if ((await t.spaceFolders.count({ spaceId: space.id })) >= MAX_FOLDERS) {
          throw new AppError(409, 'too_many', `A space can have up to ${MAX_FOLDERS} folders`);
        }
        try {
          const f = await t.spaceFolders.insert({
            spaceId: space.id,
            parentId: parent?.id ?? null,
            name: req.body.name,
            nameLower: req.body.name.toLowerCase(),
            createdBy: actor.userId,
            createdAt: new Date(),
          });
          liveTouch({ orgId: t.orgId, spaceId: space.id, kind: 'document', itemId: null });
          return (await presentFolder(t, actor, space, [f]))[0]!;
        } catch (e) {
          if (isDuplicateKey(e)) throw nameTaken();
          throw e;
        }
      });
    },
  );

  r.patch(
    '/folders/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: uuidParam,
        body: z
          .object({ name: folderName, parentId: z.string().uuid().nullable() })
          .partial()
          .strict()
          .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const { folder, space } = await loadFolder(t, actor, req.params.id);
        if (!can(actor, 'doc.delete', { ...spaceCtx(space), isAuthor: folder.createdBy === actor.userId })) throw forbidden();
        assertWritable(space);
        const set: Partial<SpaceFolderDoc> = {};
        if (req.body.name !== undefined) {
          set.name = req.body.name;
          set.nameLower = req.body.name.toLowerCase();
        }
        if (req.body.parentId !== undefined) {
          const target = await folderIn(t, space, req.body.parentId);
          const below = await subtreeIds(t, space.id, folder.id);
          if (target && below.includes(target.id)) {
            throw new AppError(422, 'invalid_folder', 'A folder cannot go inside itself', { parentId: 'Choose another folder' });
          }
          // The deepest folder in the moved branch must still fit.
          const all = await t.spaceFolders.find({ spaceId: space.id }, { projection: { id: 1, parentId: 1 } });
          const levels = (id: string): number => 1 + Math.max(0, ...all.filter((f) => f.parentId === id).map((f) => levels(f.id)));
          if ((await depthOf(t, target?.id ?? null)) + levels(folder.id) > MAX_DEPTH) {
            throw new AppError(422, 'too_deep', `Folders can go ${MAX_DEPTH} levels deep`, { parentId: 'Choose a higher folder' });
          }
          set.parentId = target?.id ?? null;
        }
        try {
          await t.spaceFolders.updateOne({ id: folder.id }, set);
        } catch (e) {
          if (isDuplicateKey(e)) throw nameTaken();
          throw e;
        }
        liveTouch({ orgId: t.orgId, spaceId: space.id, kind: 'document', itemId: null });
        return (await presentFolder(t, actor, space, [(await t.spaceFolders.get(folder.id))!]))[0]!;
      });
    },
  );

  /** Deleting a folder deletes what is inside it. Only space admins may delete a folder that is not empty. */
  r.delete('/folders/:id', { preHandler: requireAuth, schema: { params: uuidParam } }, async (req) => {
    const actor = actorOf(req);
    let keys: string[] = [];
    const out = await withTenantTx(deps.db, actor.orgId, async (t) => {
      const { folder, space } = await loadFolder(t, actor, req.params.id);
      const mine = folder.createdBy === actor.userId;
      if (!can(actor, 'doc.delete', { ...spaceCtx(space), isAuthor: mine })) throw forbidden();
      assertWritable(space);
      const tree = await subtreeIds(t, space.id, folder.id);
      const files = await t.spaceFiles.find({ spaceId: space.id, folderId: { $in: tree } });
      const empty = files.length === 0 && tree.length === 1;
      if (!empty && !can(actor, 'doc.delete', { ...spaceCtx(space), isAuthor: false })) {
        throw forbidden('Only a space admin can delete a folder that has things in it');
      }
      keys = files.map((f) => f.storageKey);
      if (files.length) await t.spaceFiles.deleteMany({ id: { $in: files.map((f) => f.id) } });
      await t.spaceFolders.deleteMany({ id: { $in: tree } });
      liveTouch({ orgId: t.orgId, spaceId: space.id, kind: 'document', itemId: null });
      return { ok: true, folders: tree.length, files: files.length };
    });
    for (const key of keys) await deps.storage.delete(key).catch((err: unknown) => req.log.warn({ err, key }, 'could not remove a stored file'));
    return out;
  });

  // ---- Files ----------------------------------------------------------------------------------------------

  /** A name not yet used in that folder: "plan.pdf", then "plan (2).pdf", "plan (3).pdf". */
  async function freeName(t: TenantDb, spaceId: string, folderId: string | null, name: string) {
    const taken = new Set((await t.spaceFiles.find({ spaceId, folderId }, { projection: { name: 1 } })).map((f) => f.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    for (let n = 2; ; n++) {
      const candidate = `${stem} (${n})${ext}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  r.post(
    '/spaces/:id/files',
    {
      preHandler: requireAuth,
      config: uploadLimit,
      schema: { params: idParam, querystring: z.object({ folder: z.string().uuid().optional() }) },
    },
    async (req, reply) => {
      const actor = actorOf(req);
      if (!req.isMultipart()) throw new AppError(415, 'unsupported_media_type', 'Send the file as multipart/form-data');

      const pre = await withTenant(deps.db, actor.orgId, async (t) => {
        const space = await resolveSpace(t, actor, req.params.id);
        if (!can(actor, 'doc.add', spaceCtx(space))) throw forbidden();
        assertWritable(space);
        const folder = await folderIn(t, space, req.query.folder);
        const plan = await loadPlan(t, actor.orgId);
        const used = await storageBytes(t);
        const storageMb = plan.limits.storage_mb;
        if (storageMb !== undefined && used >= storageMb * MB) assertWithinLimit(plan, 'storage_mb', storageMb, 1);
        return { space, folder, plan, used };
      });

      // Same four-part shape as an attachment key (the third part is the nil id: no work item).
      const key = `${actor.orgId}/${pre.space.id}/${NO_ITEM}/${randomUUID()}`;
      const got = await receiveUpload(req, deps.storage, key, pre.plan, pre.used);
      try {
        const out = await withTenantTx(deps.db, actor.orgId, async (t) => {
          const space = await resolveSpace(t, actor, pre.space.id);
          assertWritable(space);
          // The folder may have been deleted while the file was uploading.
          const folder = await folderIn(t, space, pre.folder?.id);
          const name = await freeName(t, space.id, folder?.id ?? null, cleanFileName(got.name));
          const created = await t.spaceFiles.insert({
            spaceId: space.id,
            folderId: folder?.id ?? null,
            uploaderId: actor.userId,
            name,
            mime: got.mime,
            image: got.image,
            size: got.size,
            storageKey: key,
            createdAt: new Date(),
          });
          liveTouch({ orgId: t.orgId, spaceId: space.id, kind: 'document', itemId: null });
          return (await presentFile(t, actor, space, [created]))[0]!;
        });
        return reply.send(out);
      } catch (e) {
        await deps.storage.delete(key);
        throw e;
      }
    },
  );

  r.patch(
    '/space-files/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: uuidParam,
        body: z
          .object({ name: z.string().trim().min(1, 'Enter a name').max(180).transform(cleanFileName), folderId: z.string().uuid().nullable() })
          .partial()
          .strict()
          .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const { file, space } = await loadFile(t, actor, req.params.id);
        if (!can(actor, 'doc.delete', { ...spaceCtx(space), isAuthor: file.uploaderId === actor.userId })) throw forbidden();
        assertWritable(space);
        const folderId = req.body.folderId !== undefined ? ((await folderIn(t, space, req.body.folderId))?.id ?? null) : file.folderId;
        const wanted = req.body.name ?? file.name;
        const moved = folderId !== file.folderId || wanted.toLowerCase() !== file.name.toLowerCase();
        const name = moved ? await freeName(t, space.id, folderId, wanted) : wanted;
        await t.spaceFiles.updateOne({ id: file.id }, { name, folderId });
        liveTouch({ orgId: t.orgId, spaceId: space.id, kind: 'document', itemId: null });
        return (await presentFile(t, actor, space, [(await t.spaceFiles.get(file.id))!]))[0]!;
      });
    },
  );

  r.delete('/space-files/:id', { preHandler: requireAuth, schema: { params: uuidParam } }, async (req) => {
    const actor = actorOf(req);
    const key = await withTenantTx(deps.db, actor.orgId, async (t) => {
      const { file, space } = await loadFile(t, actor, req.params.id);
      if (!can(actor, 'doc.delete', { ...spaceCtx(space), isAuthor: file.uploaderId === actor.userId })) throw forbidden();
      assertWritable(space);
      await t.spaceFiles.deleteOne({ id: file.id });
      liveTouch({ orgId: t.orgId, spaceId: space.id, kind: 'document', itemId: null });
      return file.storageKey;
    });
    await deps.storage.delete(key);
    return { ok: true };
  });
}
