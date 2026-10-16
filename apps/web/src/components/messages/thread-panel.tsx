'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, X } from 'lucide-react';
import type { MessageDTO, PersonDTO } from '@crew-deck/shared';
import { Button } from '@/components/ui/button';
import { LoadError } from '@/components/shared/load-error';
import { useIsAdmin, useMe } from '@/components/shell/me-context';
import { api, ApiError } from '@/lib/api';
import {
  channelPerms,
  conversationName,
  keys,
  useChannel,
  useMembers,
  useSetFollow,
  useThread,
} from '@/lib/messaging-api';
import { Composer } from './composer';
import { useMessageActions } from './message-actions';
import { MessageRow, PendingRow } from './message-row';
import { useRealtime } from './realtime';
import { MessageSkeletons } from './status-bits';
import { usePendingInThread } from './store';

const GROUP_MS = 5 * 60_000;

/** A thread in the right panel: the root message, its replies, and a composer with "Also send to channel". */
export function ThreadPanel({
  channelId,
  rootId,
  onClose,
}: {
  channelId: string;
  rootId: string;
  onClose: () => void;
}) {
  const me = useMe().user;
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const rt = useRealtime();
  const { channel } = useChannel(channelId);
  const thread = useThread(rootId);
  const pending = usePendingInThread(channelId, rootId);
  const members = useMembers(channelId, !!channel);
  const follow = useSetFollow(rootId);
  const scroller = useRef<HTMLDivElement>(null);

  const people = useMemo(() => {
    const map = new Map<string, PersonDTO>();
    for (const m of members.data ?? []) if (m.person) map.set(m.userId, m.person);
    for (const m of [thread.data?.root, ...(thread.data?.replies ?? [])])
      if (m?.author) map.set(m.author.id, m.author);
    return map;
  }, [members.data, thread.data]);

  const perms = channelPerms(
    channel ?? { type: 'public', isArchived: false, isAnnouncement: false },
    isAdmin,
  );
  const actions = useMessageActions({
    channelId,
    perms: channel ? perms : { ...perms, member: false },
    people,
    inThread: true,
  });
  const self: PersonDTO = { id: me.id, name: me.name, email: me.email, avatarUrl: me.avatarUrl };

  const replies = thread.data?.replies ?? [];
  const last = replies.at(-1);

  // Keep the newest reply in view, and tell the server the thread has been read.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last?.id, pending.length, thread.data?.root.id]);
  useEffect(() => {
    if (!thread.data?.following || !last) return;
    if (last.seq <= thread.data.lastReadSeq) return;
    void api(`/messages/${rootId}/follow/read`, { method: 'PUT', body: { seq: last.seq } })
      .then(() => qc.invalidateQueries({ queryKey: keys.threads }))
      .catch(() => undefined);
  }, [last?.seq, thread.data?.following, thread.data?.lastReadSeq, rootId, qc, last]);

  const name = channel ? conversationName(channel, me.id) : '';
  const gone = thread.error instanceof ApiError && thread.error.status === 404;

  return (
    <section aria-label="Thread" className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm leading-tight font-semibold">Thread</h2>
          {name && (
            <p className="text-muted-foreground truncate text-xs">
              {channel?.type === 'public' || channel?.type === 'private' ? `#${name}` : name}
            </p>
          )}
        </div>
        {thread.data && (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={thread.data.following}
            loading={follow.isPending}
            onClick={() => follow.mutate(!thread.data!.following)}
          >
            {thread.data.following ? <BellOff /> : <Bell />}{' '}
            {thread.data.following ? 'Unfollow' : 'Follow'}
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" aria-label="Close thread" onClick={onClose}>
          <X />
        </Button>
      </header>

      {thread.isLoading ? (
        <MessageSkeletons />
      ) : thread.isError ? (
        <div className="p-4">
          {gone ? (
            <p className="text-muted-foreground text-sm">This thread is no longer available.</p>
          ) : (
            <LoadError what="this thread" onRetry={() => void thread.refetch()} />
          )}
        </div>
      ) : thread.data ? (
        <>
          <div
            ref={scroller}
            className="min-h-0 flex-1 overflow-y-auto py-2"
            tabIndex={0}
            aria-label="Replies"
          >
            <MessageRow {...actions.rowProps(thread.data.root, { grouped: false })} />
            <div className="flex items-center gap-3 px-4 py-2" role="separator">
              <span className="text-muted-foreground text-xs font-medium">
                {replies.length === 0
                  ? 'No replies yet'
                  : `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
              </span>
              <span className="bg-border h-px flex-1" />
            </div>
            {replies.map((m: MessageDTO, i) => {
              const prev = replies[i - 1];
              const grouped =
                !!prev &&
                prev.kind === 'user' &&
                m.kind === 'user' &&
                prev.authorId === m.authorId &&
                new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS;
              return <MessageRow key={m.id} {...actions.rowProps(m, { grouped })} />;
            })}
            {pending.map((p, i) => (
              <PendingRow
                key={p.clientMsgId}
                pending={p}
                self={self}
                grouped={i > 0 || last?.authorId === me.id}
                onRetry={() => void rt.retry(p.clientMsgId)}
                onDiscard={() => rt.discard(p.clientMsgId)}
              />
            ))}
            {thread.data.hasMore && (
              <p className="text-muted-foreground px-4 py-2 text-center text-xs">
                Showing the first replies. Older replies load as you scroll the channel.
              </p>
            )}
          </div>
          <div className="px-3 pb-3">
            {perms.canReply ? (
              <Composer
                key={rootId}
                draftKey={`thread:${rootId}`}
                channelId={channelId}
                alsoInChannelOption
                placeholder="Reply…"
                onTyping={() => rt.typing(channelId)}
                onSubmit={(doc, text, extra) =>
                  rt.send(channelId, doc, text, {
                    threadRootId: rootId,
                    alsoInChannel: extra.alsoInChannel,
                    files: extra.files,
                  })
                }
              />
            ) : (
              <p className="text-muted-foreground bg-muted/50 rounded-lg border border-dashed px-3 py-3 text-center text-sm">
                {channel?.isArchived ? 'This channel is archived.' : 'Join the channel to reply.'}
              </p>
            )}
          </div>
        </>
      ) : null}
      {actions.nodes}
    </section>
  );
}
