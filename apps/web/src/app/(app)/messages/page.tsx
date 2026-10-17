'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Hash, MessagesSquare, Plus, Search, SquarePen, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import {
  BrowseChannelsDialog,
  CreateChannelDialog,
  NewMessageDialog,
} from '@/components/messages/dialogs';
import { Stagger, StaggerItem } from '@/components/shared/motion';
import { useCanCreateChannel, useChannels } from '@/lib/messaging-api';

export default function MessagesHome() {
  const canCreate = useCanCreateChannel();
  const [dialog, setDialog] = useState<'new' | 'create' | 'browse' | null>(null);
  const channels = useChannels().data;
  // The conversations to pick back up: unread first, then the most recently active.
  const recent = useMemo(
    () =>
      [...(channels ?? [])]
        .filter((c) => !c.isArchived)
        .sort(
          (a, b) =>
            Number(b.unread > 0) - Number(a.unread > 0) ||
            (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''),
        )
        .slice(0, 4),
    [channels],
  );
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
      <EmptyState
        icon={MessagesSquare}
        title="Pick a conversation"
        description="Choose a channel or direct message from the list, or start something new."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => setDialog('new')}>
              <SquarePen /> New message
            </Button>
            <Button variant="outline" onClick={() => setDialog('browse')}>
              <Search /> Browse channels
            </Button>
            {canCreate && (
              <Button variant="outline" onClick={() => setDialog('create')}>
                <Plus /> Create a channel
              </Button>
            )}
          </div>
        }
      />
      {recent.length > 0 && (
        <section aria-label="Jump back in" className="w-full max-w-md space-y-2">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            Jump back in
          </h2>
          <Stagger className="space-y-1.5">
            {recent.map((c) => {
              const dm = c.type === 'dm' || c.type === 'group_dm';
              const label = c.name ?? c.people?.map((p) => p.name ?? p.email).join(', ') ?? 'Conversation';
              return (
                <StaggerItem key={c.id}>
                  <Link
                    href={`/messages/${c.id}`}
                    className="bg-card hover:border-primary/40 flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-[border-color,transform] duration-200 hover:-translate-y-0.5"
                  >
                    {dm ? <User className="text-muted-foreground size-4" aria-hidden /> : <Hash className="text-muted-foreground size-4" aria-hidden />}
                    <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                    {c.unread > 0 && (
                      <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs font-medium">
                        {c.unread > 99 ? '99+' : c.unread}
                      </span>
                    )}
                  </Link>
                </StaggerItem>
              );
            })}
          </Stagger>
        </section>
      )}
      <NewMessageDialog open={dialog === 'new'} onOpenChange={(o) => setDialog(o ? 'new' : null)} />
      <CreateChannelDialog
        open={dialog === 'create'}
        onOpenChange={(o) => setDialog(o ? 'create' : null)}
      />
      <BrowseChannelsDialog
        open={dialog === 'browse'}
        onOpenChange={(o) => setDialog(o ? 'browse' : null)}
      />
    </div>
  );
}
