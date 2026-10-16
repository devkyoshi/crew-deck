'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadError } from '@/components/shared/load-error';
import { useHydrated } from '@/components/checkin/use-hydrated';
import { PersonAvatar } from '@/components/messages/person-avatar';
import { MessageSkeletons } from '@/components/messages/status-bits';
import { conversationName, personName, useChannels, useThreadsList } from '@/lib/messaging-api';
import { useMe } from '@/components/shell/me-context';
import { cn } from '@/lib/utils';

const ago = (iso: string) => {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hr ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
};

/** Threads I follow, most recently active first, with the unread ones marked. */
export default function ThreadsPage() {
  const router = useRouter();
  const me = useMe().user;
  const hydrated = useHydrated();
  const threads = useThreadsList();
  const channels = useChannels().data ?? [];
  const where = (id: string) => {
    const c = channels.find((x) => x.id === id);
    return !c
      ? 'a conversation'
      : c.type === 'public' || c.type === 'private'
        ? `#${c.name}`
        : conversationName(c, me.id);
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label="Back to conversations"
          onClick={() => router.push('/messages')}
        >
          <ArrowLeft />
        </Button>
        <MessageSquare className="text-muted-foreground size-5" aria-hidden />
        <h1 className="text-[15px] font-semibold">Threads</h1>
      </header>
      {threads.isLoading || !hydrated ? (
        <MessageSkeletons />
      ) : threads.isError ? (
        <div className="p-6">
          <LoadError what="your threads" onRetry={() => void threads.refetch()} />
        </div>
      ) : !threads.data?.length ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon={MessageSquare}
            title="No threads yet"
            description="Threads you reply in, or are mentioned in, show up here with what is new."
          />
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
          {threads.data.map(({ root, unread, latestReply }) => (
            <li key={root.id}>
              <Link
                href={`/messages/${root.channelId}?m=${root.seq}&thread=${root.id}`}
                className="hover:bg-muted/50 focus-visible:ring-ring/50 flex gap-3 px-4 py-3 outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
              >
                <PersonAvatar person={root.author} presence={false} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span
                      className={cn(
                        'text-foreground text-sm',
                        unread ? 'font-bold' : 'font-semibold',
                      )}
                    >
                      {personName(root.author)}
                    </span>
                    <span className="text-muted-foreground">{where(root.channelId)}</span>
                    {root.lastReplyAt && (
                      <time dateTime={root.lastReplyAt} className="text-muted-foreground">
                        {ago(root.lastReplyAt)}
                      </time>
                    )}
                  </span>
                  <span className={cn('line-clamp-2 block text-sm', unread && 'font-medium')}>
                    {root.bodyText ?? 'This message was deleted'}
                  </span>
                  {latestReply && (
                    <span className="text-muted-foreground mt-1 line-clamp-1 block text-[13px]">
                      <span className="font-medium">
                        {personName(latestReply.author).split(' ')[0]}:
                      </span>{' '}
                      {latestReply.bodyText}
                    </span>
                  )}
                  <span className="text-muted-foreground mt-0.5 block text-xs">
                    {root.replyCount} {root.replyCount === 1 ? 'reply' : 'replies'}
                  </span>
                </span>
                {unread > 0 && (
                  <span
                    className="bg-destructive text-white h-5 min-w-5 self-center rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold tabular-nums"
                    aria-label={`${unread} new replies`}
                  >
                    {unread}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
