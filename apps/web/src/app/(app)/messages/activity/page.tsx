'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, AtSign, SmilePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadError } from '@/components/shared/load-error';
import { useHydrated } from '@/components/checkin/use-hydrated';
import { PersonAvatar } from '@/components/messages/person-avatar';
import { MessageSkeletons } from '@/components/messages/status-bits';
import { conversationName, personName, useActivity, useChannels } from '@/lib/messaging-api';
import { useMe } from '@/components/shell/me-context';

const when = (iso: string) =>
  new Date(iso).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

/** Who mentioned me, and who reacted to what I wrote. */
export default function ActivityPage() {
  const router = useRouter();
  const me = useMe().user;
  const hydrated = useHydrated();
  const activity = useActivity();
  const channels = useChannels().data ?? [];
  const where = (c: { id: string; type: string; name: string | null }) =>
    c.type === 'public' || c.type === 'private'
      ? `#${c.name}`
      : conversationName(
          channels.find((x) => x.id === c.id) ?? { type: c.type as 'dm', name: null },
          me.id,
        );
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
        <AtSign className="text-muted-foreground size-5" aria-hidden />
        <h1 className="text-[15px] font-semibold">Mentions and reactions</h1>
      </header>
      {activity.isLoading || !hydrated ? (
        <MessageSkeletons />
      ) : activity.isError ? (
        <div className="p-6">
          <LoadError what="your activity" onRetry={() => void activity.refetch()} />
        </div>
      ) : !activity.data?.length ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon={AtSign}
            title="Nothing yet"
            description="When someone mentions you or reacts to one of your messages, it appears here."
          />
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
          {activity.data.map((a) => (
            <li key={`${a.kind}-${a.message.id}-${a.at}-${a.emoji ?? ''}`}>
              <Link
                href={`/messages/${a.channel.id}?m=${a.message.seq}${a.message.threadRootId && !a.message.alsoInChannel ? `&thread=${a.message.threadRootId}` : ''}`}
                className="hover:bg-muted/50 focus-visible:ring-ring/50 flex gap-3 px-4 py-3 outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
              >
                <span className="relative">
                  <PersonAvatar person={a.by} presence={false} />
                  <span className="bg-background absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full border">
                    {a.kind === 'mention' ? (
                      <AtSign className="size-2.5" aria-hidden />
                    ) : (
                      <SmilePlus className="size-2.5" aria-hidden />
                    )}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-sm">
                    <span className="font-semibold">{personName(a.by)}</span>{' '}
                    {a.kind === 'mention' ? (
                      'mentioned you in'
                    ) : (
                      <>
                        reacted <span className="text-base">{a.emoji}</span> to your message in
                      </>
                    )}{' '}
                    <span className="font-medium">{where(a.channel)}</span>
                  </span>
                  <span className="text-muted-foreground line-clamp-2 block text-[13px]">
                    {a.message.bodyText}
                  </span>
                  <time dateTime={a.at} className="text-muted-foreground text-xs">
                    {when(a.at)}
                  </time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
