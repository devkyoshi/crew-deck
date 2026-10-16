'use client';

import { useState } from 'react';
import type { MessageDTO, MyChannelDTO } from '@crew-deck/shared';
import { Composer } from '@/components/messages/composer';
import { ConversationListItem } from '@/components/messages/conversation-list';
import { MessageRow, PendingRow } from '@/components/messages/message-row';
import { PersonAvatar, PresenceDot } from '@/components/messages/person-avatar';
import { RichContent } from '@/components/messages/rich-content';
import { MessageSkeletons } from '@/components/messages/status-bits';
import { Button } from '@/components/ui/button';

/**
 * The messaging building blocks, in the order a person meets them. The live pieces (the virtualized
 * list, realtime events, dialogs) are built from these; shared components appear here first so they can
 * be reviewed in both themes before the full screens use them.
 */

const ALICE = { id: 'u-alice', name: 'Alice Acme', email: 'alice@acme.test', avatarUrl: null };
const BEN = { id: 'u-ben', name: 'Ben Builder', email: 'ben@acme.test', avatarUrl: null };
const GONE = {
  id: 'u-gone',
  name: 'Sam Gone',
  email: 'sam@acme.test',
  avatarUrl: null,
  deactivated: true,
};

const t = (text: string, marks?: object[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (...content: object[]) => ({ type: 'paragraph', content });
const doc = (...content: object[]) => ({ type: 'doc' as const, content });

const now = Date.now();
let seq = 0;
const msg = (over: Partial<MessageDTO>): MessageDTO => ({
  id: `m${++seq}`,
  channelId: 'c1',
  seq,
  kind: 'user',
  authorId: ALICE.id,
  author: ALICE,
  body: doc(p(t('Hello'))),
  bodyText: 'Hello',
  clientMsgId: null,
  threadRootId: null,
  alsoInChannel: false,
  replyCount: 0,
  editedAt: null,
  deletedAt: null,
  createdAt: new Date(now - 5 * 60_000).toISOString(),
  ...over,
});

const channel = (over: Partial<MyChannelDTO>): MyChannelDTO => ({
  id: 'c',
  type: 'public',
  name: 'general',
  topic: null,
  description: null,
  spaceId: null,
  isAnnouncement: false,
  isArchived: false,
  lastSeq: 10,
  lastMessageAt: null,
  createdAt: new Date(now).toISOString(),
  memberCount: 12,
  role: 'member',
  notificationLevel: 'all',
  mutedUntil: null,
  isStarred: false,
  lastReadSeq: 10,
  unread: 0,
  ...over,
});

const noop = () => {};
const rowProps = {
  selfId: ALICE.id,
  canModerate: false,
  canEdit: true,
  editing: false,
  highlighted: false,
  onEdit: noop,
  onCancelEdit: noop,
  onSaveEdit: async () => {},
  onDelete: noop,
  onMarkUnread: noop,
  onCopyLink: noop,
};

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </div>
  );
}

export function MessagesShowcase() {
  const [sent, setSent] = useState<string | null>(null);
  return (
    <section className="space-y-6">
      <h2 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
        Messaging
      </h2>

      <Block title="Conversation list items (bold when unread; direct messages show a count)">
        <ul className="bg-sidebar/40 w-72 space-y-px rounded-lg border p-1">
          <li>
            <ConversationListItem
              channel={channel({ name: 'general', unread: 0 })}
              selfId={ALICE.id}
              href="#"
            />
          </li>
          <li>
            <ConversationListItem
              channel={channel({ name: 'design-review', unread: 3 })}
              selfId={ALICE.id}
              href="#"
            />
          </li>
          <li>
            <ConversationListItem
              channel={channel({ type: 'private', name: 'leadership' })}
              selfId={ALICE.id}
              href="#"
              active
            />
          </li>
          <li>
            <ConversationListItem
              channel={channel({ name: 'old-launch', isArchived: true })}
              selfId={ALICE.id}
              href="#"
            />
          </li>
          <li>
            <ConversationListItem
              channel={channel({ type: 'dm', name: null, people: [BEN], unread: 2 })}
              selfId={ALICE.id}
              href="#"
            />
          </li>
          <li>
            <ConversationListItem
              channel={channel({ type: 'group_dm', name: null, people: [BEN, GONE] })}
              selfId={ALICE.id}
              href="#"
            />
          </li>
        </ul>
      </Block>

      <Block title="Avatars and presence (status is a label as well as a colour)">
        <div className="flex flex-wrap items-center gap-6 text-sm">
          {(['online', 'away', 'dnd', 'offline'] as const).map((s) => (
            <span key={s} className="flex items-center gap-2">
              <span className="relative">
                <PersonAvatar person={ALICE} presence={false} />
                <PresenceDot state={s} className="absolute -right-0.5 -bottom-0.5" />
              </span>
              {s === 'dnd' ? 'Do not disturb' : s}
            </span>
          ))}
        </div>
      </Block>

      <Block title="Message rows">
        <div className="bg-background overflow-hidden rounded-lg border py-2">
          <MessageRow
            {...rowProps}
            message={msg({
              body: doc(
                p(
                  t('Morning everyone! Here is the '),
                  t('plan', [{ type: 'bold' }]),
                  t(' for today.'),
                ),
              ),
            })}
            grouped={false}
          />
          <MessageRow
            {...rowProps}
            message={msg({
              body: doc(p(t('Second message in the same minute: the avatar and name are hidden.'))),
            })}
            grouped
          />
          <MessageRow
            {...rowProps}
            message={msg({
              author: BEN,
              authorId: BEN.id,
              editedAt: new Date(now).toISOString(),
              body: doc(
                p(
                  t('Here is the command, with '),
                  t('inline code', [{ type: 'code' }]),
                  t(' and a '),
                  t('link', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
                  t('.'),
                ),
                {
                  type: 'codeBlock',
                  attrs: { language: 'bash' },
                  content: [t('pnpm build && pnpm test')],
                },
                {
                  type: 'bulletList',
                  content: [
                    { type: 'listItem', content: [p(t('First point'))] },
                    { type: 'listItem', content: [p(t('Second point'))] },
                  ],
                },
              ),
            })}
            grouped={false}
          />
          <MessageRow
            {...rowProps}
            message={msg({ body: null, bodyText: null, deletedAt: new Date(now).toISOString() })}
            grouped={false}
          />
          <MessageRow
            {...rowProps}
            highlighted
            message={msg({ body: doc(p(t('Highlighted: this is the message a link points to.'))) })}
            grouped={false}
          />
          <MessageRow
            {...rowProps}
            message={msg({
              kind: 'system',
              bodyText: 'joined the channel',
              authorId: BEN.id,
              author: BEN,
            })}
            grouped={false}
          />
          <MessageRow
            {...rowProps}
            message={msg({
              kind: 'bot',
              authorId: null,
              author: { id: 'bot', name: 'Activity', email: '', avatarUrl: null },
              body: doc(p(t('ENG-142 moved to Done'))),
            })}
            grouped={false}
          />
          <MessageRow
            {...rowProps}
            message={msg({
              author: GONE,
              authorId: GONE.id,
              body: doc(p(t('A message from someone who has left the company.'))),
            })}
            grouped={false}
          />
        </div>
      </Block>

      <Block title="Sending and failed (a failed message stays in the list with a retry)">
        <div className="bg-background overflow-hidden rounded-lg border py-2">
          <PendingRow
            pending={{
              clientMsgId: 'a',
              channelId: 'c1',
              body: doc(p(t('Sending… slightly dimmed until the server confirms.'))),
              text: '',
              status: 'sending',
              createdAt: now,
            }}
            self={ALICE}
            grouped={false}
            onRetry={noop}
            onDiscard={noop}
          />
          <PendingRow
            pending={{
              clientMsgId: 'b',
              channelId: 'c1',
              body: doc(p(t('This one did not go through.'))),
              text: '',
              status: 'failed',
              error: 'Not sent. Check your connection and try again.',
              createdAt: now,
            }}
            self={ALICE}
            grouped={false}
            onRetry={noop}
            onDiscard={noop}
          />
        </div>
      </Block>

      <Block title="Composer (Enter sends, Shift+Enter adds a line, drafts are kept)">
        <Composer placeholder="Message #design-review" onSubmit={(_doc, text) => setSent(text)} />
        {sent && <p className="text-muted-foreground text-xs">Would send: “{sent}”</p>}
      </Block>

      <Block title="Rich content">
        <div className="bg-background rounded-lg border p-3">
          <RichContent
            doc={doc(
              { type: 'blockquote', content: [p(t('Ship it when green.'))] },
              p(t('Mention: '), { type: 'mention', attrs: { id: 'x', label: 'Ben Builder' } }),
            )}
          />
        </div>
      </Block>

      <Block title="Loading and empty">
        <div className="bg-background rounded-lg border">
          <MessageSkeletons />
        </div>
        <Button variant="outline" size="sm" disabled>
          Typing indicator and connection banner appear live in the conversation
        </Button>
      </Block>
    </section>
  );
}
