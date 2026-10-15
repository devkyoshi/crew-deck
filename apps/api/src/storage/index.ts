import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, type Readable, type Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

/**
 * File storage behind a small interface, so the local disk used in development and single-server
 * installs can be swapped for object storage later without touching the routes. Keys are built only
 * from ids (`{org}/{space}/{item}/{uuid}`); the file's own name is kept in the database, never on
 * disk, so a name cannot steer where a file is written.
 */
export interface StorageDriver {
  /** Writes the stream (through any transforms) under `key` and returns the bytes written. */
  put(key: string, body: Readable, ...through: Transform[]): Promise<number>;
  get(key: string): Readable;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[0-9a-f-]{36}(\/[0-9a-f-]{36}){3}$/;

export class LocalDiskDriver implements StorageDriver {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private pathFor(key: string) {
    if (!KEY_RE.test(key)) throw new Error('storage: invalid key');
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('storage: key escapes the root');
    return full;
  }

  async put(key: string, body: Readable, ...through: Transform[]) {
    const full = this.pathFor(key);
    await mkdir(path.dirname(full), { recursive: true });
    await pipeline([body, ...through, createWriteStream(full, { flags: 'wx' })]);
    return (await stat(full)).size;
  }

  get(key: string) {
    return createReadStream(this.pathFor(key));
  }

  async delete(key: string) {
    await rm(this.pathFor(key), { force: true });
  }
}

/** The slice of the S3 client the driver uses, so tests can stand in for the network. */
export interface S3Like {
  upload(input: { Bucket: string; Key: string; Body: Readable }): Promise<void>;
  download(input: { Bucket: string; Key: string }): Promise<Readable>;
  remove(input: { Bucket: string; Key: string }): Promise<void>;
}

/** Object storage (S3, or anything speaking its API). Files still stream through the API, so access checks and signed links are unchanged. */
export class S3Driver implements StorageDriver {
  constructor(
    private readonly client: S3Like,
    private readonly bucket: string,
    private readonly prefix = '',
  ) {}

  private keyFor(key: string) {
    if (!KEY_RE.test(key)) throw new Error('storage: invalid key');
    return this.prefix ? `${this.prefix.replace(/\/+$/, '')}/${key}` : key;
  }

  async put(key: string, body: Readable, ...through: Transform[]) {
    let bytes = 0;
    const counter = new PassThrough();
    counter.on('data', (chunk: Buffer) => (bytes += chunk.length));
    // The write fails (and nothing is kept) if any transform, such as the size limit, errors out.
    const source = through.reduce<Readable>((from, t) => from.pipe(t), body);
    const failed = new Promise<never>((_, reject) => {
      for (const s of [body, ...through]) s.on('error', reject);
    });
    const upload = this.client.upload({ Bucket: this.bucket, Key: this.keyFor(key), Body: source.pipe(counter) });
    try {
      await Promise.race([upload, failed]);
    } catch (e) {
      counter.destroy();
      await this.delete(key).catch(() => undefined);
      throw e;
    }
    return bytes;
  }

  get(key: string) {
    const out = new PassThrough();
    this.client.download({ Bucket: this.bucket, Key: this.keyFor(key) }).then(
      (stream) => {
        stream.on('error', (e) => out.destroy(e));
        stream.pipe(out);
      },
      (e) => out.destroy(e as Error),
    );
    return out;
  }

  async delete(key: string) {
    await this.client.remove({ Bucket: this.bucket, Key: this.keyFor(key) });
  }
}

export function createStorage(config: {
  STORAGE_DRIVER: 'local' | 's3';
  STORAGE_DIR: string;
  S3_BUCKET?: string;
  S3_REGION?: string;
  S3_ENDPOINT?: string;
  S3_FORCE_PATH_STYLE?: boolean;
  S3_PREFIX?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
}): StorageDriver {
  switch (config.STORAGE_DRIVER) {
    case 'local':
      return new LocalDiskDriver(config.STORAGE_DIR);
    case 's3': {
      if (!config.S3_BUCKET) throw new Error('S3_BUCKET must be set when STORAGE_DRIVER is s3');
      return new S3Driver(awsClient(config), config.S3_BUCKET, config.S3_PREFIX);
    }
  }
}

function awsClient(config: Parameters<typeof createStorage>[0]): S3Like {
  const client = new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials:
      config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }
        : undefined,
  });
  return {
    async upload(input) {
      await new Upload({ client, params: input }).done();
    },
    async download(input) {
      const res = await client.send(new GetObjectCommand(input));
      return res.Body as Readable;
    },
    async remove(input) {
      await client.send(new DeleteObjectCommand(input));
    },
  };
}

// ---- Signed links ---------------------------------------------------------------------------------------

/** How long a file link works. Links are handed out per request, so this only needs to cover a page view. */
export const LINK_TTL_SECONDS = 15 * 60;

const sign = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(payload).digest('base64url');

/**
 * A short-lived link to one attachment in one workspace. The workspace is part of the signature but not
 * the link: the server takes it from the address the link is opened on, so a link only works there.
 */
export function signFileUrl(
  secret: string,
  claims: { attachmentId: string; orgId: string },
  now = Date.now(),
) {
  const e = Math.floor(now / 1000) + LINK_TTL_SECONDS;
  return `/api/v1/files/${claims.attachmentId}?e=${e}&s=${sign(secret, `${claims.attachmentId}.${claims.orgId}.${e}`)}`;
}

/** True when the signature matches and the link has not expired. */
export function verifyFileSignature(
  secret: string,
  claims: { attachmentId: string; orgId: string; e: number; s: string },
  now = Date.now(),
) {
  if (!Number.isInteger(claims.e) || claims.e * 1000 < now) return false;
  const expected = Buffer.from(sign(secret, `${claims.attachmentId}.${claims.orgId}.${claims.e}`));
  const given = Buffer.from(claims.s);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ---- Content checks -------------------------------------------------------------------------------------

/** Image types shown inline. Everything else downloads. SVG is deliberately not here (it can run script). */
const IMAGES: [string, (b: Buffer) => boolean][] = [
  ['image/png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/gif', (b) => b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a'],
  ['image/webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
];

const EXECUTABLE_MAGIC: ((b: Buffer) => boolean)[] = [
  (b) => b[0] === 0x4d && b[1] === 0x5a, // MZ: Windows executables and DLLs
  (b) => b.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), // ELF
  (b) => ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe'].includes(b.subarray(0, 4).toString('hex')), // Mach-O
  (b) => b[0] === 0x23 && b[1] === 0x21, // "#!" scripts
];

const EXECUTABLE_EXT = new Set([
  'exe', 'dll', 'com', 'scr', 'msi', 'msp', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'jse', 'wsf',
  'wsh', 'hta', 'cpl', 'lnk', 'reg', 'sh', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'apk', 'jar',
]);

/** What a file really is, judged from its first bytes and name. */
export function inspectFile(head: Buffer, name: string) {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const executable = EXECUTABLE_EXT.has(ext) || EXECUTABLE_MAGIC.some((m) => m(head));
  const image = IMAGES.find(([, test]) => test(head))?.[0] ?? null;
  return { executable, image };
}

/** A display name that is safe in headers and on any file system: no paths, controls or odd characters. */
export function cleanFileName(raw: string) {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
  return cleaned || 'file';
}
