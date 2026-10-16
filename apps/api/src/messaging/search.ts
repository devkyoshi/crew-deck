import type { ChannelType, MessageDTO, ParsedSearch, SearchHit } from '@crew-deck/shared';
import type { TenantDb } from '../db/client.js';
import type { MessageDoc } from '../db/types.js';
import { escapeRegex } from '../lib/pagination.js';
import type { Actor } from '../permissions/can.js';
import type { MessagingCtx } from './context.js';
import { hydrate } from './dto.js';

/**
 * Search over everything a person can access. Access is part of the query, never a filter applied after
 * fetching: the channels searched are the ones the person is in plus public channels, and nothing else
 * can be returned. The engine sits behind `SearchService`, so Meilisearch or OpenSearch can replace the
 * MongoDB text index later without any API change.
 */
export interface SearchService {
  messages(
    ctx: MessagingCtx,
    actor: Actor,
    query: string,
    opts?: { page?: number; limit?: number },
  ): Promise<SearchResult>;
  files(
    ctx: MessagingCtx,
    actor: Actor,
    query: string,
    opts?: { limit?: number },
  ): Promise<FileHit[]>;
}

export interface SearchResult {
  hits: SearchHit[];
  parsed: ParsedSearch;
  /** Operators that matched nobody (an unknown `from:`, or a channel that does not exist or is not visible). */
  unresolved: string[];
  page: number;
  hasMore: boolean;
}

export interface FileHit {
  id: string;
  name: string;
  mime: string;
  size: number;
  isImage: boolean;
  url: string;
  channel: { id: string; type: ChannelType; name: string | null };
  messageId: string;
  seq: number | null;
  createdAt: string;
}

// ---- Query language ---------------------------------------------------------------------------------------

const OPERATORS = ['from', 'in', 'before', 'after', 'has', 'is'] as const;

/** Splits a query into words and "quoted phrases". */
function tokens(raw: string): string[] {
  const out: string[] = [];
  const re = /(?:[a-z]+:)?"[^"]*"|\S+/gi;
  for (const m of raw.matchAll(re)) out.push(m[0]);
  return out;
}

const unquote = (v: string) => v.replace(/^"(.*)"$/, '$1');
const isDay = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/**
 * Reads `from:`, `in:`, `before:`, `after:`, `has:file|link` and `is:thread` out of a query; everything
 * else is the text to search for. Unknown operators stay in the text.
 */
export function parseSearch(raw: string): ParsedSearch {
  const out: ParsedSearch = {
    text: '',
    from: [],
    in: [],
    before: null,
    after: null,
    has: [],
    is: [],
  };
  const text: string[] = [];
  for (const tok of tokens(raw.slice(0, 500))) {
    const m = tok.match(/^([a-z]+):(.*)$/i);
    const op = m?.[1]?.toLowerCase() as (typeof OPERATORS)[number] | undefined;
    const value = m ? unquote(m[2]!).replace(/^[@#]/, '') : '';
    if (!op || !OPERATORS.includes(op) || !value) {
      text.push(tok);
      continue;
    }
    if (op === 'from') out.from.push(value);
    else if (op === 'in') out.in.push(value);
    else if (op === 'before' && isDay(value)) out.before = value;
    else if (op === 'after' && isDay(value)) out.after = value;
    else if (op === 'has' && (value === 'file' || value === 'link')) out.has.push(value);
    else if (op === 'is' && value === 'thread') out.is.push('thread');
    else text.push(tok);
  }
  out.text = text.join(' ').trim();
  return out;
}

// ---- Access ---------------------------------------------------------------------------------------------------

/** The channels a person may search: those they are in, and public ones. This is the access rule. */
export async function searchableChannels(t: TenantDb, userId: string) {
  const [mine, open] = await Promise.all([
    t.channelMembers.find({ userId }, { projection: { channelId: 1 } }),
    t.channels.find({ type: 'public' }, { projection: { id: 1 } }),
  ]);
  return new Set([...mine.map((m) => m.channelId), ...open.map((c) => c.id)]);
}

async function resolvePeople(t: TenantDb, names: string[]) {
  if (names.length === 0) return { ids: [] as string[], missing: [] as string[] };
  const members = await t.memberships.find({ status: 'active' }, { projection: { userId: 1 } });
  const users = [...(await t.users(members.map((m) => m.userId))).values()];
  const ids: string[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const q = name.toLowerCase();
    const segments = (v: string) =>
      v
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
    const found = users.filter(
      (u) =>
        u.id === name ||
        u.email.toLowerCase() === q ||
        (u.name ?? '').toLowerCase() === q ||
        [...segments(u.name ?? ''), ...segments(u.email.split('@')[0] ?? '')].some((w) =>
          w.startsWith(q),
        ),
    );
    if (found.length === 0) missing.push(`from:${name}`);
    ids.push(...found.map((u) => u.id));
  }
  return { ids: [...new Set(ids)], missing };
}

// ---- Snippets ---------------------------------------------------------------------------------------------------

const words = (text: string) =>
  [...text.matchAll(/"([^"]+)"|(\S+)/g)]
    .map((m) => (m[1] ?? m[2] ?? '').toLowerCase())
    .filter((w) => w.length > 0 && !w.startsWith('-'));

/** The text around the first match, split into plain and matching parts (the UI never parses HTML). */
export function snippetOf(bodyText: string | null, query: string): SearchHit['snippet'] {
  const text = (bodyText ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const terms = words(query);
  if (terms.length === 0) return [{ text: text.slice(0, 160), match: false }];
  const re = new RegExp(`(${terms.map(escapeRegex).join('|')})`, 'gi');
  const first = text.search(re);
  const start = Math.max(0, (first < 0 ? 0 : first) - 60);
  const end = Math.min(text.length, start + 200);
  const part = `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
  return part
    .split(re)
    .filter((s) => s !== '')
    .map((s) => ({ text: s, match: terms.includes(s.toLowerCase()) }));
}

// ---- The MongoDB implementation ----------------------------------------------------------------------------

export const mongoSearch: SearchService = {
  async messages(ctx, actor, query, opts = {}) {
    const t = ctx.db.tenant(actor.orgId);
    const parsed = parseSearch(query);
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
    const page = Math.max(opts.page ?? 1, 1);
    const empty: SearchResult = { hits: [], parsed, unresolved: [], page, hasMore: false };
    if (
      !parsed.text &&
      !parsed.from.length &&
      !parsed.in.length &&
      !parsed.has.length &&
      !parsed.is.length &&
      !parsed.before &&
      !parsed.after
    ) {
      return empty;
    }

    const allowed = await searchableChannels(t, actor.userId);
    const unresolved: string[] = [];
    let channelIds = [...allowed];
    if (parsed.in.length) {
      const wanted = parsed.in.map((n) => n.toLowerCase());
      const named = await t.channels.find(
        { id: { $in: channelIds }, nameLower: { $in: wanted } },
        { projection: { id: 1, nameLower: 1 } },
      );
      for (const n of wanted) if (!named.some((c) => c.nameLower === n)) unresolved.push(`in:${n}`);
      channelIds = named.map((c) => c.id);
    }
    const from = await resolvePeople(t, parsed.from);
    unresolved.push(...from.missing);
    if (unresolved.length) return { ...empty, unresolved };

    const and: Record<string, unknown>[] = [
      // The access rule, inside the query.
      { channelId: { $in: channelIds } },
      { deletedAt: null },
      { kind: { $in: ['user', 'bot'] } },
    ];
    if (parsed.text) and.push({ $text: { $search: parsed.text, $language: 'none' } });
    if (from.ids.length) and.push({ authorId: { $in: from.ids } });
    if (parsed.after) and.push({ createdAt: { $gte: new Date(`${parsed.after}T00:00:00Z`) } });
    if (parsed.before) and.push({ createdAt: { $lt: new Date(`${parsed.before}T00:00:00Z`) } });
    // Links are flagged when the message is saved (a link mark's text is not its address); bare addresses in older messages are found by text.
    if (parsed.has.includes('link'))
      and.push({ $or: [{ hasLink: true }, { bodyText: { $regex: 'https?://', $options: 'i' } }] });
    if (parsed.has.includes('file')) {
      const withFiles = await t.messageAttachments.find(
        { channelId: { $in: channelIds }, messageId: { $ne: null } },
        { projection: { messageId: 1 }, limit: 5000 },
      );
      and.push({ id: { $in: [...new Set(withFiles.map((f) => f.messageId!))] } });
    }
    if (parsed.is.includes('thread'))
      and.push({ $or: [{ threadRootId: { $ne: null } }, { replyCount: { $gt: 0 } }] });

    const rows = await t.messages.find({ $and: and } as never, {
      sort: parsed.text
        ? ({ score: { $meta: 'textScore' }, createdAt: -1 } as never)
        : { createdAt: -1 },
      projection: parsed.text ? ({ score: { $meta: 'textScore' } } as never) : undefined,
      skip: (page - 1) * limit,
      limit: limit + 1,
    });
    const slice: MessageDoc[] = rows.slice(0, limit);
    const dtos = new Map((await hydrate(t, slice)).map((d) => [d.id, d as MessageDTO]));
    const channels = await t.channels.find({
      id: { $in: [...new Set(slice.map((m) => m.channelId))] },
    });
    const channelOf = new Map(channels.map((c) => [c.id, c]));
    // Direct messages have no name: show who they are with.
    const hits: SearchHit[] = slice.map((m) => ({
      message: dtos.get(m.id)!,
      channel: {
        id: m.channelId,
        type: channelOf.get(m.channelId)!.type,
        name: channelOf.get(m.channelId)!.name,
      },
      snippet: snippetOf(m.bodyText, parsed.text),
    }));
    return { hits, parsed, unresolved, page, hasMore: rows.length > limit };
  },

  async files(ctx, actor, query, opts = {}) {
    const t = ctx.db.tenant(actor.orgId);
    const q = query.trim().slice(0, 100);
    if (!q) return [];
    const allowed = [...(await searchableChannels(t, actor.userId))];
    const rows = await t.messageAttachments.find(
      {
        channelId: { $in: allowed },
        messageId: { $ne: null },
        name: { $regex: escapeRegex(q), $options: 'i' },
      },
      { sort: { createdAt: -1 }, limit: Math.min(opts.limit ?? 30, 100) },
    );
    const [channels, msgs] = await Promise.all([
      t.channels.find({ id: { $in: [...new Set(rows.map((r) => r.channelId))] } }),
      t.messages.find(
        { id: { $in: rows.map((r) => r.messageId!) } },
        { projection: { id: 1, seq: 1 } },
      ),
    ]);
    const channelOf = new Map(channels.map((c) => [c.id, c]));
    const seqOf = new Map(msgs.map((m) => [m.id, m.seq]));
    return rows
      .filter((r) => channelOf.has(r.channelId))
      .map((r) => ({
        id: r.id,
        name: r.name,
        mime: r.mime,
        size: r.size,
        isImage: r.image !== null,
        url: `/api/v1/message-files/${r.id}`,
        channel: {
          id: r.channelId,
          type: channelOf.get(r.channelId)!.type,
          name: channelOf.get(r.channelId)!.name,
        },
        messageId: r.messageId!,
        seq: seqOf.get(r.messageId!) ?? null,
        createdAt: r.createdAt.toISOString(),
      }));
  },
};
