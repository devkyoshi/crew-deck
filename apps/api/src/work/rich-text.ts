import { AppError } from '../lib/errors.js';
import { docToText } from './doc.js';

/**
 * Rich text (descriptions and comments) arrives as Tiptap / ProseMirror JSON from the browser. It is
 * rebuilt here from an allow-list, so unknown nodes, marks and attributes never reach the database
 * or another person's screen. Links may only use http, https or mailto.
 */

type Json = Record<string, unknown>;
export type RichDoc = { type: 'doc'; content: Json[] };

/** Allowed node types and how to copy their attributes. */
const NODES: Record<string, (attrs: Json) => Json | undefined> = {
  doc: () => undefined,
  paragraph: () => undefined,
  text: () => undefined,
  hardBreak: () => undefined,
  horizontalRule: () => undefined,
  blockquote: () => undefined,
  bulletList: () => undefined,
  listItem: () => undefined,
  taskList: () => undefined,
  orderedList: (a) => ({ start: clampInt(a.start, 1, 1, 10_000) }),
  heading: (a) => ({ level: clampInt(a.level, 2, 1, 3) }),
  taskItem: (a) => ({ checked: a.checked === true }),
  codeBlock: (a) => ({
    language: typeof a.language === 'string' && /^[a-z0-9+#-]{1,20}$/i.test(a.language) ? a.language : null,
  }),
  mention: (a) => ({
    id: typeof a.id === 'string' ? a.id : '',
    label: typeof a.label === 'string' ? a.label.slice(0, 100) : null,
    kind: MENTION_KINDS.includes(a.kind as string) ? (a.kind as string) : 'user',
  }),
};

const MARKS: Record<string, (attrs: Json) => Json | undefined | null> = {
  bold: () => undefined,
  italic: () => undefined,
  strike: () => undefined,
  underline: () => undefined,
  code: () => undefined,
  // A link with an unsafe address is dropped (the text stays).
  link: (a) => (typeof a.href === 'string' && SAFE_HREF.test(a.href) ? { href: a.href.slice(0, 2000) } : null),
};

const MENTION_KINDS = ['user', 'group', 'channel', 'here'];
const SAFE_HREF = /^(https?:\/\/|mailto:)[^\s]+$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 200_000;
const MAX_DEPTH = 24;
const MAX_TEXT = 20_000;

function clampInt(v: unknown, fallback: number, min: number, max: number) {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

const invalid = (field: string, message = 'That text could not be saved. Try removing unusual formatting.') =>
  new AppError(422, 'invalid_document', message, { [field]: message });

export interface CleanDoc {
  /** The rebuilt document, or null when it holds nothing. */
  doc: RichDoc | null;
  /** Ids of everyone mentioned by name, once each, in order. */
  mentions: string[];
  /** Everything mentioned: people, groups, @channel and @here (messages only). */
  targets: { type: 'user' | 'group' | 'channel' | 'here'; id: string }[];
  /** Plain text, for search, previews and the activity log. */
  text: string;
}

/** Validates and rebuilds a rich text document. `field` names the input in error messages. */
export function sanitizeDoc(
  input: unknown,
  field = 'body',
  /** Messages may mention groups, @channel and @here; work item text may not. */
  opts: { broadcastMentions?: boolean } = {},
): CleanDoc {
  if (input === null || input === undefined) return { doc: null, mentions: [], targets: [], text: '' };
  if (JSON.stringify(input).length > MAX_BYTES) throw invalid(field, 'That text is too long');
  const mentions: string[] = [];
  const targets: CleanDoc['targets'] = [];

  const walk = (node: unknown, depth: number): Json => {
    if (depth > MAX_DEPTH || !node || typeof node !== 'object' || Array.isArray(node)) throw invalid(field);
    const n = node as Json;
    const type = n.type;
    if (typeof type !== 'string' || !(type in NODES)) throw invalid(field);
    if (depth > 0 && type === 'doc') throw invalid(field);
    const out: Json = { type };
    const attrs = NODES[type]!((n.attrs as Json | undefined) ?? {});
    if (attrs) out.attrs = attrs;
    if (type === 'mention') {
      const { id, kind } = attrs as { id: string; kind: CleanDoc['targets'][number]['type'] };
      if (kind !== 'user' && !opts.broadcastMentions) throw invalid(field);
      if (kind === 'channel' || kind === 'here') {
        if (id !== kind) throw invalid(field);
      } else if (!UUID.test(id)) throw invalid(field);
      if (!targets.some((x) => x.type === kind && x.id === id)) targets.push({ type: kind, id });
      if (kind === 'user' && !mentions.includes(id)) mentions.push(id);
    }
    if (type === 'text') {
      if (typeof n.text !== 'string' || n.text.length === 0) throw invalid(field);
      out.text = n.text;
      if (Array.isArray(n.marks)) {
        const marks: Json[] = [];
        for (const m of n.marks as unknown[]) {
          const mt = (m as Json | null)?.type;
          if (typeof mt !== 'string' || !(mt in MARKS)) throw invalid(field);
          const ma = MARKS[mt]!(((m as Json).attrs as Json | undefined) ?? {});
          if (ma === null) continue;
          marks.push(ma ? { type: mt, attrs: ma } : { type: mt });
        }
        if (marks.length) out.marks = marks;
      }
      return out;
    }
    if (n.content !== undefined) {
      if (!Array.isArray(n.content)) throw invalid(field);
      out.content = (n.content as unknown[]).map((c) => walk(c, depth + 1));
    }
    return out;
  };

  const root = walk(input, 0);
  if (root.type !== 'doc') throw invalid(field);
  const doc = { type: 'doc', content: (root.content as Json[] | undefined) ?? [] } as RichDoc;
  const text = docToText(doc).trim();
  if (text.length > MAX_TEXT) throw invalid(field, 'That text is too long');
  if (!text && targets.length === 0) return { doc: null, mentions: [], targets: [], text: '' };
  return { doc, mentions, targets, text };
}

/** Mentions inside a stored document (used when a description is edited). */
export function mentionsIn(doc: unknown): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const node = n as Json;
    if (node.type === 'mention') {
      const id = (node.attrs as Json | undefined)?.id;
      if (typeof id === 'string' && !out.includes(id)) out.push(id);
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(doc);
  return out;
}
