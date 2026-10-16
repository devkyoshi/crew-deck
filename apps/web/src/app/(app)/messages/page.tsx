'use client';

import { useState } from 'react';
import { MessagesSquare, Plus, Search, SquarePen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import {
  BrowseChannelsDialog,
  CreateChannelDialog,
  NewMessageDialog,
} from '@/components/messages/dialogs';

export default function MessagesHome() {
  const [dialog, setDialog] = useState<'new' | 'create' | 'browse' | null>(null);
  return (
    <div className="flex h-full items-center justify-center p-6">
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
            <Button variant="outline" onClick={() => setDialog('create')}>
              <Plus /> Create a channel
            </Button>
          </div>
        }
      />
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
