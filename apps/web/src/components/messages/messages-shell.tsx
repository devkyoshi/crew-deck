'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useChannel } from '@/lib/messaging-api';
import { cn } from '@/lib/utils';
import { ChannelDetails } from './channel-details';
import { ConversationList } from './conversation-list';
import { PanelProvider, usePanel } from './panel';
import { ThreadPanel } from './thread-panel';

function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    const on = () => setWide(mql.matches);
    on();
    mql.addEventListener('change', on);
    return () => mql.removeEventListener('change', on);
  }, []);
  return wide;
}

function DetailsPanel({ channelId }: { channelId: string }) {
  const panel = usePanel();
  const wide = useWide();
  const { channel } = useChannel(channelId);
  const thread = panel.thread && panel.thread.channelId === channelId ? panel.thread : null;
  const shown = !!thread || panel.open;

  // Esc closes the panel (menus, dialogs and the composer handle their own Esc first).
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role=dialog],[role=menu],[role=listbox]')) return;
      if (thread) panel.closeThread();
      else panel.setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, thread, panel]);

  if (!channel && !thread) return null;
  const close = () => (thread ? panel.closeThread() : panel.setOpen(false));
  const body = (docked: boolean) =>
    thread ? (
      <ThreadPanel channelId={thread.channelId} rootId={thread.rootId} onClose={close} />
    ) : channel ? (
      <ChannelDetails
        channel={channel}
        onClose={docked ? close : undefined}
        onGone={() => panel.setOpen(false)}
      />
    ) : null;
  // Wide screens get a docked panel; tablets and phones get it as a sheet over the conversation.
  if (wide) {
    return shown ? (
      <aside
        aria-label={thread ? 'Thread' : 'Channel details'}
        className="bg-background w-96 shrink-0 border-l"
      >
        {body(true)}
      </aside>
    ) : null;
  }
  return (
    <Sheet open={shown} onOpenChange={(o) => !o && close()}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-sm"
        // Opening the panel should not drop the cursor into (and select) the first field.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetTitle className="sr-only">{thread ? 'Thread' : 'Channel details'}</SheetTitle>
        <SheetDescription className="sr-only">
          {thread
            ? 'The replies to one message'
            : 'Members, topic and settings for this conversation'}
        </SheetDescription>
        {body(false)}
      </SheetContent>
    </Sheet>
  );
}

/**
 * The Messages area: conversation list, the open conversation, and a details panel. On a phone the
 * list and the conversation are separate screens; on a tablet the panel overlays; on a desktop all
 * three sit side by side.
 */
export function MessagesShell({ children }: { children: ReactNode }) {
  const channelId = useParams<{ channelId?: string }>().channelId ?? null;
  return (
    <PanelProvider>
      {/* Below the 3rem top bar (and the inset margin on larger screens). dvh keeps the composer above a phone keyboard. */}
      <div className="flex h-[calc(100dvh-3rem)] min-h-0 md:h-[calc(100dvh-4rem)]">
        <aside
          aria-label="Messages sidebar"
          className={cn(
            'bg-sidebar/40 w-full shrink-0 border-r md:block md:w-72',
            channelId ? 'hidden' : 'block',
          )}
        >
          <ConversationList activeId={channelId} />
        </aside>
        <section
          aria-label="Conversation"
          className={cn('min-w-0 flex-1 md:block', channelId ? 'block' : 'hidden')}
        >
          {children}
        </section>
        {channelId && <DetailsPanel channelId={channelId} />}
      </div>
    </PanelProvider>
  );
}
