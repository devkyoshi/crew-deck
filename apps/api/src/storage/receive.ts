import { Transform } from 'node:stream';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';
import type { EffectivePlan } from '../plans/index.js';
import { cleanFileName, inspectFile, type StorageDriver } from './index.js';

const MB = 1024 * 1024;
/** Hard ceiling for any upload, whatever the plan says (multipart parser limit). */
export const MAX_UPLOAD_BYTES = 100 * MB;
const HEAD_BYTES = 64;

const tooBig = (mb: number) =>
  new AppError(413, 'file_too_large', `Files can be up to ${mb} MB on your plan`, {
    file: `Choose a file of ${mb} MB or less`,
  });

/**
 * Takes one uploaded file from a multipart request into storage under `key`, enforcing the plan's file
 * size and storage limits and refusing programs and scripts. On any failure nothing is left in storage.
 * `used` is the workspace's bytes in use before this upload.
 */
export async function receiveUpload(
  req: FastifyRequest,
  storage: StorageDriver,
  key: string,
  plan: EffectivePlan,
  used: number,
) {
  const fileMb = plan.limits.max_attachment_mb;
  const maxBytes = Math.min(fileMb !== undefined ? fileMb * MB : MAX_UPLOAD_BYTES, MAX_UPLOAD_BYTES);
  const file = await req.file({ limits: { fileSize: maxBytes, files: 1 } });
  if (!file) throw new AppError(422, 'validation_error', 'Choose a file to upload', { file: 'Choose a file' });

  const name = cleanFileName(file.filename);
  // Keep the first bytes to check what the file really is.
  let head = Buffer.alloc(0);
  const tap = new Transform({
    transform(chunk: Buffer, _enc, done) {
      if (head.length < HEAD_BYTES) head = Buffer.concat([head, chunk]).subarray(0, HEAD_BYTES);
      done(null, chunk);
    },
  });
  const discard = async (err: unknown) => {
    await storage.delete(key);
    return err;
  };
  let size: number;
  try {
    size = await storage.put(key, file.file, tap);
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
  const storageMb = plan.limits.storage_mb;
  if (storageMb !== undefined && used + size > storageMb * MB) {
    throw await discard(
      new AppError(402, 'plan_limit', `The ${plan.name} plan allows up to ${storageMb} MB of storage.`, {
        limit: 'storage_mb',
        plan: plan.key ?? '',
      }),
    );
  }
  return {
    name,
    size,
    image: kind.image,
    mime: kind.image ?? (file.mimetype || 'application/octet-stream').slice(0, 100),
    fileMb,
  };
}
