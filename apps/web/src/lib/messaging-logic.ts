import type { ChannelDTO, MessageDTO, PersonDTO } from '@crew-deck/shared';

/**
 * Pure helpers behind the Messages screens: merging live events into the cached conversation, laying
 * messages out as rows, and naming conversations. No React and no imports from the app, so they are
 * easy to test.
 */

/** The cached view of one conversation: what is loaded, and whether more exists either side. */
export interface ChannelView {
  messages: MessageDTO[];
  hasOlder: boolean;
  hasNewer: boolean;
  lastSeq: number;
}

/**
 * Merges messages into a view: deduplicated by id (and by client id, so the echo of my own send
 * replaces nothing twice), ordered by `seq`. A tombstone or edit replaces what was there.
 */
export function mergeMessages(view: ChannelView, incoming: MessageDTO[]): ChannelView {
  const byId = new Map(view.messages.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  const messages = [...byId.values()].sort((a, b) => a.seq - b.seq);
  const lastSeq = Math.max(view.lastSeq, ...incoming.map((m) => m.seq));
  return { ...view, messages, lastSeq };
}

/** True when `seq` leaves a hole after the newest message we hold (a push we missed). */
export const hasGap = (view: ChannelView, seq: number) =>
  !view.hasNewer && view.messages.length > 0 && seq > view.lastSeq + 1;

export const personName = (p: Pick<PersonDTO, 'name' | 'email'> | null | undefined) =>
  p?.name || p?.email || 'Someone';

/** What to call a conversation: `#name` for channels, the other people for direct messages. */
export function conversationName(c: Pick<ChannelDTO, 'type' | 'name' | 'people'>, selfId?: string) {
  if (c.type === 'dm' || c.type === 'group_dm') {
    const people = c.people ?? [];
    if (people.length === 0) return 'Direct message';
    if (people.length === 1 && people[0]!.id === selfId) return `${personName(people[0])} (you)`;
    if (people.length === 1) return personName(people[0]);
    return people.map((p) => personName(p).split(' ')[0]).join(', ');
  }
  return c.name ?? 'channel';
}

/** A message that has been typed and sent but not yet acknowledged by the server. */
export interface PendingLike {
  clientMsgId: string;
  createdAt: number;
}

const GROUP_MS = 5 * 60_000;

export type Row<P extends PendingLike = PendingLike> =
  | { kind: 'start'; key: string }
  | { kind: 'date'; key: string; label: string }
  | { kind: 'unread'; key: string }
  | { kind: 'msg'; key: string; m: MessageDTO; grouped: boolean }
  | { kind: 'pending'; key: string; p: P; grouped: boolean };

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function dayLabel(d: Date) {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (dayKey(d) === dayKey(now)) return 'Today';
  if (dayKey(d) === dayKey(yesterday)) return 'Yesterday';
  return d.toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  });
}

/**
 * Flattens messages into display rows: date separators, the "New messages" divider, and grouping of
 * consecutive messages by the same author within five minutes.
 */
export function buildRows<P extends PendingLike>(
  messages: MessageDTO[],
  pending: P[],
  opts: { selfId: string; lastReadSeq: number; showStart: boolean },
): Row<P>[] {
  const rows: Row<P>[] = [];
  if (opts.showStart) rows.push({ kind: 'start', key: 'start' });
  let lastDay: string | null = null;
  let prev: { author: string | null; at: number; groupable: boolean } | null = null;
  const dayRow = (at: Date) => {
    const day = dayKey(at);
    if (day === lastDay) return;
    rows.push({ kind: 'date', key: `date-${day}`, label: dayLabel(at) });
    lastDay = day;
    prev = null;
  };
  const place = (at: Date, author: string | null, groupable: boolean) => {
    dayRow(at);
    const grouped =
      !!prev &&
      prev.groupable &&
      groupable &&
      prev.author === author &&
      at.getTime() - prev.at < GROUP_MS;
    prev = { author, at: at.getTime(), groupable };
    return grouped;
  };
  let dividerPlaced = false;
  for (const m of messages) {
    if (!dividerPlaced && m.seq > opts.lastReadSeq && m.authorId !== opts.selfId) {
      dividerPlaced = true;
      dayRow(new Date(m.createdAt));
      rows.push({ kind: 'unread', key: 'unread' });
      prev = null;
    }
    const grouped = place(new Date(m.createdAt), m.authorId, m.kind === 'user');
    rows.push({ kind: 'msg', key: m.id, m, grouped });
  }
  for (const p of pending) {
    const grouped = place(new Date(p.createdAt), opts.selfId, true);
    rows.push({ kind: 'pending', key: `p-${p.clientMsgId}`, p, grouped });
  }
  return rows;
}
