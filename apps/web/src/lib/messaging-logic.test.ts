import type { MessageDTO } from '@crew-deck/shared';
import { describe, expect, it } from 'vitest';
import {
  buildRows,
  conversationName,
  hasGap,
  mergeMessages,
  personName,
  type ChannelView,
} from './messaging-logic';

const person = (id: string, name: string | null = id) => ({
  id,
  name,
  email: `${id}@x.test`,
  avatarUrl: null,
});

let n = 0;
function msg(over: Partial<MessageDTO> & { seq: number }): MessageDTO {
  const authorId = over.authorId === undefined ? 'ann' : over.authorId;
  return {
    id: `m${over.seq}-${n++}`,
    channelId: 'c1',
    kind: 'user',
    author: authorId ? person(authorId) : null,
    body: { type: 'doc', content: [] },
    bodyText: `text ${over.seq}`,
    clientMsgId: null,
    threadRootId: null,
    alsoInChannel: false,
    replyCount: 0,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    ...over,
    authorId,
  } as MessageDTO;
}

const view = (messages: MessageDTO[], extra: Partial<ChannelView> = {}): ChannelView => ({
  messages,
  hasOlder: false,
  hasNewer: false,
  lastSeq: Math.max(0, ...messages.map((m) => m.seq)),
  ...extra,
});

describe('mergeMessages', () => {
  it('orders by seq and never duplicates a message that arrives twice', () => {
    const a = msg({ seq: 1 });
    const b = msg({ seq: 2 });
    const merged = mergeMessages(view([b]), [a, b, a]);
    expect(merged.messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(merged.lastSeq).toBe(2);
  });

  it('replaces a message with its edited or deleted version', () => {
    const a = msg({ seq: 1 });
    const edited = { ...a, bodyText: 'new', editedAt: new Date().toISOString() };
    const out = mergeMessages(view([a]), [edited]);
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0]!.bodyText).toBe('new');
    const gone = mergeMessages(out, [
      { ...a, body: null, bodyText: null, deletedAt: new Date().toISOString() },
    ]);
    expect(gone.messages[0]!.deletedAt).toBeTruthy();
  });

  it('keeps the highest known lastSeq and the paging flags', () => {
    const v = view([msg({ seq: 5 })], { hasOlder: true, lastSeq: 9 });
    const out = mergeMessages(v, [msg({ seq: 6 })]);
    expect(out.lastSeq).toBe(9);
    expect(out.hasOlder).toBe(true);
  });
});

describe('hasGap', () => {
  it('detects a skipped seq after the newest message', () => {
    const v = view([msg({ seq: 1 }), msg({ seq: 2 })]);
    expect(hasGap(v, 3)).toBe(false);
    expect(hasGap(v, 4)).toBe(true);
  });

  it('does not report gaps while viewing older history', () => {
    expect(hasGap(view([msg({ seq: 1 })], { hasNewer: true }), 50)).toBe(false);
  });

  it('does not report a gap for an empty view', () => {
    expect(hasGap(view([]), 5)).toBe(false);
  });
});

describe('buildRows', () => {
  const opts = { selfId: 'me', lastReadSeq: 999, showStart: false };
  const kinds = (rows: { kind: string }[]) => rows.map((r) => r.kind);
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

  it('adds one date separator per day', () => {
    const day = 86_400_000;
    const rows = buildRows(
      [
        msg({ seq: 1, createdAt: new Date(Date.now() - 3 * day).toISOString() }),
        msg({ seq: 2, createdAt: new Date(Date.now() - 3 * day + 1000).toISOString() }),
        msg({ seq: 3, createdAt: new Date().toISOString() }),
      ],
      [],
      opts,
    );
    expect(kinds(rows)).toEqual(['date', 'msg', 'msg', 'date', 'msg']);
    expect(
      rows.filter((r) => r.kind === 'date').map((r) => (r as { label: string }).label),
    ).toContain('Today');
  });

  it('groups consecutive messages by one author within five minutes', () => {
    const rows = buildRows(
      [
        msg({ seq: 1, createdAt: at(30) }),
        msg({ seq: 2, createdAt: at(29) }),
        msg({ seq: 3, createdAt: at(10) }), // more than five minutes later: new group
        msg({ seq: 4, createdAt: at(9), authorId: 'bob' }), // other author: new group
        msg({ seq: 5, createdAt: at(8), authorId: 'bob' }),
      ],
      [],
      opts,
    );
    const grouped = rows
      .filter((r) => r.kind === 'msg')
      .map((r) => (r as { grouped: boolean }).grouped);
    expect(grouped).toEqual([false, true, false, false, true]);
  });

  const groupedOf = (rows: { kind: string }[]) =>
    rows.filter((r) => r.kind === 'msg').map((r) => (r as unknown as { grouped: boolean }).grouped);

  it('starts a new run after ten minutes even when each gap is short', () => {
    const rows = buildRows(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) =>
        msg({ seq: i + 1, createdAt: at(40 - i * 3) }),
      ),
      [],
      opts,
    );
    // 3 minute steps: runs of 4 (0, 3, 6, 9 minutes), then the next starts a new run.
    expect(groupedOf(rows).slice(0, 5)).toEqual([false, true, true, true, false]);
  });

  it('starts a new run after eight messages', () => {
    const rows = buildRows(
      Array.from({ length: 10 }, (_, i) => msg({ seq: i + 1, createdAt: at(10 - i * 0.1) })),
      [],
      opts,
    );
    expect(groupedOf(rows)).toEqual([false, ...Array(7).fill(true), false, true]);
  });

  it('gives a thread reply echoed into the channel its own header', () => {
    const rows = buildRows(
      [
        msg({ seq: 1, createdAt: at(3) }),
        msg({ seq: 2, createdAt: at(2), threadRootId: 'root', alsoInChannel: true }),
        msg({ seq: 3, createdAt: at(1) }),
      ],
      [],
      opts,
    );
    expect(groupedOf(rows)).toEqual([false, false, false]);
  });

  it('never groups system messages with user messages', () => {
    const rows = buildRows(
      [
        msg({ seq: 1, createdAt: at(3) }),
        msg({ seq: 2, createdAt: at(2), kind: 'system' }),
        msg({ seq: 3, createdAt: at(1) }),
      ],
      [],
      opts,
    );
    const grouped = rows
      .filter((r) => r.kind === 'msg')
      .map((r) => (r as { grouped: boolean }).grouped);
    expect(grouped).toEqual([false, false, false]);
  });

  it('places the New messages divider before the first unread message from someone else', () => {
    const rows = buildRows(
      [
        msg({ seq: 1 }),
        msg({ seq: 2 }),
        msg({ seq: 3, authorId: 'me' }),
        msg({ seq: 4 }),
        msg({ seq: 5 }),
      ],
      [],
      { ...opts, lastReadSeq: 2 },
    );
    const at4 = rows.findIndex((r) => r.kind === 'unread');
    expect(at4).toBeGreaterThan(0);
    const next = rows[at4 + 1] as { kind: string; m: MessageDTO };
    // My own message (seq 3) is never "new" to me, so the divider sits before seq 4.
    expect(next.m.seq).toBe(4);
    expect(rows.filter((r) => r.kind === 'unread')).toHaveLength(1);
  });

  it('has no divider when everything has been read', () => {
    const rows = buildRows([msg({ seq: 1 }), msg({ seq: 2 })], [], { ...opts, lastReadSeq: 2 });
    expect(kinds(rows)).not.toContain('unread');
  });

  it('puts the divider first when the very first loaded message is unread', () => {
    const rows = buildRows([msg({ seq: 1 })], [], { ...opts, lastReadSeq: 0 });
    expect(kinds(rows)).toEqual(['date', 'unread', 'msg']);
  });

  it('shows pending messages last and groups them with my previous message', () => {
    const rows = buildRows(
      [msg({ seq: 1, authorId: 'me', createdAt: at(1) })],
      [{ clientMsgId: 'x', createdAt: Date.now() }],
      opts,
    );
    const last = rows.at(-1)!;
    expect(last.kind).toBe('pending');
    expect((last as { grouped: boolean }).grouped).toBe(true);
  });

  it('starts with the conversation intro only when the whole history is loaded', () => {
    expect(kinds(buildRows([msg({ seq: 1 })], [], { ...opts, showStart: true }))[0]).toBe('start');
    expect(kinds(buildRows([msg({ seq: 1 })], [], opts))[0]).toBe('date');
  });
});

describe('naming', () => {
  it('names direct messages after the other people', () => {
    expect(
      conversationName({ type: 'dm', name: null, people: [person('bob', 'Bob Brown')] }, 'me'),
    ).toBe('Bob Brown');
    expect(
      conversationName(
        {
          type: 'group_dm',
          name: null,
          people: [person('bob', 'Bob Brown'), person('cy', 'Cy Clark')],
        },
        'me',
      ),
    ).toBe('Bob, Cy');
    expect(
      conversationName({ type: 'dm', name: null, people: [person('me', 'Me Myself')] }, 'me'),
    ).toBe('Me Myself (you)');
    expect(conversationName({ type: 'dm', name: null, people: [] }, 'me')).toBe('Direct message');
  });

  it('uses the channel name for channels, and falls back to email for unnamed people', () => {
    expect(conversationName({ type: 'public', name: 'general' })).toBe('general');
    expect(personName(person('x', null))).toBe('x@x.test');
    expect(personName(null)).toBe('Someone');
  });
});
