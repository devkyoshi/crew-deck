'use client';

import Link from 'next/link';
import { FileText, ImageIcon, Pin } from 'lucide-react';
import type { PersonDTO } from '@crew-deck/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadError } from '@/components/shared/load-error';
import { personName, useChannelFiles, usePins } from '@/lib/messaging-api';
import { MessageRow } from './message-row';
import { formatSize } from './message-parts';
import type { MessageRowProps } from './message-row';
import type { MessageDTO } from '@crew-deck/shared';

/** The Pins tab: messages an owner or admin pinned, shown like normal messages. */
export function PinsView({
  channelId,
  canPin,
  rowProps,
}: {
  channelId: string;
  canPin: boolean;
  rowProps: (m: MessageDTO, o: { grouped: boolean }) => MessageRowProps;
}) {
  const pins = usePins(channelId);
  if (pins.isLoading)
    return <p className="text-muted-foreground p-6 text-sm">Loading pinned messages…</p>;
  if (pins.isError)
    return <LoadError what="the pinned messages" onRetry={() => void pins.refetch()} />;
  if (!pins.data?.length) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          icon={Pin}
          title="Nothing pinned yet"
          description={
            canPin
              ? 'Pin important messages from the message menu so everyone can find them here.'
              : 'Pinned messages will appear here. Channel owners and admins can pin them.'
          }
        />
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-2">
      {pins.data.map((m) => (
        <div key={m.id} className="border-b last:border-0">
          <MessageRow {...rowProps(m, { grouped: false })} />
          <p className="px-4 pb-2 pl-16 text-xs">
            <Link
              href={`/messages/${channelId}?m=${m.seq}`}
              className="text-primary hover:underline"
            >
              Jump to message
            </Link>
          </p>
        </div>
      ))}
    </div>
  );
}

/** The Files tab: everything shared in the channel, newest first. */
export function FilesView({
  channelId,
  onOpenImage,
}: {
  channelId: string;
  onOpenImage: (
    images: {
      id: string;
      name: string;
      mime: string;
      size: number;
      isImage: boolean;
      url: string;
    }[],
    index: number,
  ) => void;
}) {
  const files = useChannelFiles(channelId);
  if (files.isLoading) return <p className="text-muted-foreground p-6 text-sm">Loading files…</p>;
  if (files.isError) return <LoadError what="the files" onRetry={() => void files.refetch()} />;
  if (!files.data?.length) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          icon={FileText}
          title="No files shared yet"
          description="Files and images sent in this channel appear here. Drop one anywhere in the conversation to share it."
        />
      </div>
    );
  }
  const images = files.data.filter((f) => f.isImage);
  const others = files.data.filter((f) => !f.isImage);
  const who = (p: PersonDTO | null) => personName(p);
  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
      {images.length > 0 && (
        <section aria-label="Images">
          <h3 className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
            <ImageIcon className="size-3.5" /> Images
          </h3>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {images.map((f, i) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => onOpenImage(images, i)}
                  aria-label={`View ${f.name}`}
                  className="bg-muted focus-visible:ring-ring/50 block aspect-[4/3] w-full overflow-hidden rounded-lg border outline-none focus-visible:ring-[3px]"
                >
                  <img src={f.url} alt={f.name} loading="lazy" className="size-full object-cover" />
                </button>
                <p className="text-muted-foreground mt-1 truncate text-xs">
                  {who(f.uploader)} ·{' '}
                  {new Date(f.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {others.length > 0 && (
        <section aria-label="Documents">
          <h3 className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
            <FileText className="size-3.5" /> Files
          </h3>
          <ul className="divide-y rounded-lg border">
            {others.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-3 py-2">
                <FileText className="text-muted-foreground size-6 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <a
                    href={f.url}
                    download={f.name}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {f.name}
                  </a>
                  <p className="text-muted-foreground text-xs">
                    {formatSize(f.size)} · {who(f.uploader)} ·{' '}
                    {new Date(f.createdAt).toLocaleDateString([], {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </p>
                </div>
                {f.seq !== null && (
                  <Link
                    href={`/messages/${channelId}?m=${f.seq}`}
                    className="text-primary text-xs hover:underline"
                  >
                    Show in conversation
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
