'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Bookmark, BookmarkX } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadError } from '@/components/shared/load-error';
import { useHydrated } from '@/components/checkin/use-hydrated';
import { AttachmentList } from '@/components/messages/message-parts';
import { PersonAvatar } from '@/components/messages/person-avatar';
import { RichContent } from '@/components/messages/rich-content';
import { MessageSkeletons } from '@/components/messages/status-bits';
import { personName, useSaved, useSetSaved } from '@/lib/messaging-api';

export default function SavedPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const saved = useSaved();
  const unsave = useSetSaved();
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
        <Bookmark className="text-muted-foreground size-5" aria-hidden />
        <h1 className="text-[15px] font-semibold">Saved for later</h1>
      </header>
      {saved.isLoading || !hydrated ? (
        <MessageSkeletons />
      ) : saved.isError ? (
        <div className="p-6">
          <LoadError what="your saved messages" onRetry={() => void saved.refetch()} />
        </div>
      ) : !saved.data?.length ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon={Bookmark}
            title="Nothing saved yet"
            description="Save a message from its menu to keep it here, just for you."
          />
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
          {saved.data.map(({ message: m, channel, savedAt }) => (
            <li key={m.id} className="flex gap-3 px-4 py-3">
              <PersonAvatar person={m.author} presence={false} />
              <div className="min-w-0 flex-1">
                <p className="text-muted-foreground flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="text-foreground text-sm font-semibold">
                    {personName(m.author)}
                  </span>
                  {channel.type === 'public' || channel.type === 'private'
                    ? `in #${channel.name}`
                    : 'in a direct message'}
                  <time dateTime={m.createdAt}>
                    {new Date(m.createdAt).toLocaleString([], {
                      day: 'numeric',
                      month: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </time>
                </p>
                {m.deletedAt ? (
                  <p className="text-muted-foreground text-sm italic">This message was deleted</p>
                ) : (
                  <RichContent doc={m.body} />
                )}
                <AttachmentList attachments={m.attachments} onOpenImage={() => undefined} />
                <p className="mt-1 flex gap-3 text-xs">
                  <Link
                    href={`/messages/${channel.id}?m=${m.seq}`}
                    className="text-primary hover:underline"
                  >
                    Jump to message
                  </Link>
                  <span className="text-muted-foreground">
                    Saved{' '}
                    {new Date(savedAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}
                  </span>
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remove from saved"
                loading={unsave.isPending && unsave.variables?.messageId === m.id}
                onClick={() =>
                  unsave.mutate(
                    { messageId: m.id, saved: false },
                    { onError: () => toast.error('Could not remove it') },
                  )
                }
              >
                <BookmarkX />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
