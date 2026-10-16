import { createHash } from 'node:crypto';
import { S2C, type LinkPreviewDTO } from '@crew-deck/shared';
import type { Redis } from 'ioredis';
import type { Db } from '../db/client.js';
import { createTenantQueue, createTenantWorker, type TenantJobData } from '../lib/redis.js';
import type { EventSink } from './events.js';
import { hydrate } from './dto.js';
import { assertFetchable, fetchPage, type FetchedPage } from './ssrf.js';

const QUEUE = 'messaging-link-previews';
const FRESH_MS = 24 * 3600_000;
const MAX_LINKS = 3;

export interface LinkPreviewJob extends TenantJobData {
  messageId: string;
  urls: string[];
}
export type EnqueueLinkPreviews = (job: LinkPreviewJob) => Promise<void> | void;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();

/** The http(s) links in a message: link marks and bare addresses, once each, at most three. */
export function linksIn(doc: unknown, text: string): string[] {
  const out: string[] = [];
  const add = (u: string) => {
    const clean = u.replace(/[).,;:!?]+$/, '');
    try {
      assertFetchable(clean);
    } catch {
      return; // never even queue links that could not be fetched
    }
    if (!out.includes(clean)) out.push(clean);
  };
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const node = n as {
      marks?: { type: string; attrs?: { href?: string } }[];
      content?: unknown[];
    };
    for (const m of node.marks ?? []) if (m.type === 'link' && m.attrs?.href) add(m.attrs.href);
    node.content?.forEach(walk);
  };
  walk(doc);
  for (const m of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) add(m[0]);
  return out.slice(0, MAX_LINKS);
}

function meta(html: string, key: string): string | null {
  const re = new RegExp(`<meta\\s+[^>]*(?:property|name)=["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  const content = tag.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decode(content) : null;
}

/** Title, description, image and site name from a page's Open Graph (or plain) tags. */
export function parsePreview(page: FetchedPage): LinkPreviewDTO {
  const head = page.html.slice(0, 200_000);
  const title =
    meta(head, 'og:title') ??
    meta(head, 'twitter:title') ??
    decode(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const description =
    meta(head, 'og:description') ?? meta(head, 'description') ?? meta(head, 'twitter:description');
  const rawImage = meta(head, 'og:image') ?? meta(head, 'twitter:image');
  let imageUrl: string | null = null;
  if (rawImage) {
    try {
      const u = new URL(rawImage, page.url);
      if (u.protocol === 'https:' || u.protocol === 'http:') imageUrl = u.toString().slice(0, 1000);
    } catch {
      /* unusable image address */
    }
  }
  return {
    url: page.url,
    title: title ? title.slice(0, 200) : null,
    description: description ? description.slice(0, 300) : null,
    imageUrl,
    siteName: meta(head, 'og:site_name')?.slice(0, 100) ?? new URL(page.url).hostname,
  };
}

export interface PreviewDeps {
  db: Db;
  events: EventSink;
  /** Replaced in tests; production fetches with the SSRF guards. */
  fetch?: (url: string) => Promise<FetchedPage>;
}

/**
 * Looks up the links of one message, using the workspace's cache (a day) before touching the network,
 * stores the result on the message and tells the channel. Failures are cached too and simply leave the
 * message without a card.
 */
export async function runLinkPreviews(deps: PreviewDeps, job: LinkPreviewJob) {
  const t = deps.db.tenant(job.orgId);
  const fetchIt = deps.fetch ?? ((u: string) => fetchPage(u));
  const previews: LinkPreviewDTO[] = [];
  for (const url of job.urls.slice(0, MAX_LINKS)) {
    const urlHash = createHash('sha256').update(url).digest('hex');
    const cached = await t.linkPreviews.findOne({ urlHash });
    if (cached && Date.now() - cached.fetchedAt.getTime() < FRESH_MS) {
      if (cached.status === 'ok') {
        previews.push({
          url: cached.url,
          title: cached.title,
          description: cached.description,
          imageUrl: cached.imageUrl,
          siteName: cached.siteName,
        });
      }
      continue;
    }
    try {
      const p = parsePreview(await fetchIt(url));
      const useful = !!(p.title || p.description);
      await t.linkPreviews.upsert(
        { urlHash },
        {
          url,
          title: p.title,
          description: p.description,
          imageUrl: p.imageUrl,
          siteName: p.siteName,
          status: useful ? 'ok' : 'failed',
          fetchedAt: new Date(),
        },
      );
      if (useful) previews.push({ ...p, url });
    } catch {
      await t.linkPreviews.upsert({ urlHash }, { url, status: 'failed', fetchedAt: new Date() });
    }
  }
  const msg = await t.messages.findOneAndUpdate({ id: job.messageId, deletedAt: null }, {
    metadata: { previews, previewsPending: false },
  } as never);
  if (!msg) return;
  const [dto] = await hydrate(t, [msg]);
  if (dto) deps.events.toChannel(job.orgId, msg.channelId, S2C.messageUpdated, dto);
}

/** Just the producing side, for processes that queue lookups but do not run them (the realtime gateway). */
export function createLinkPreviewEnqueuer(redis: Redis) {
  const queue = createTenantQueue<LinkPreviewJob>(QUEUE, redis);
  const enqueue: EnqueueLinkPreviews = async (job) => {
    await queue.add('preview', job, {
      jobId: `${job.orgId}-${job.messageId}-${Date.now()}`,
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  };
  return { enqueue, close: () => queue.close() };
}

export function startLinkPreviewJobs(
  redis: Redis,
  db: Db,
  events: EventSink,
  log: { error: (m: string) => void },
) {
  const queue = createTenantQueue<LinkPreviewJob>(QUEUE, redis);
  const worker = createTenantWorker<LinkPreviewJob>(QUEUE, redis, (job) =>
    runLinkPreviews({ db, events }, job.data),
  );
  worker.on('failed', (job, err) => log.error(`link preview failed: ${err.message} (${job?.id})`));
  const enqueue: EnqueueLinkPreviews = async (job) => {
    await queue.add('preview', job, {
      jobId: `${job.orgId}-${job.messageId}-${Date.now()}`,
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  };
  return {
    enqueue,
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
