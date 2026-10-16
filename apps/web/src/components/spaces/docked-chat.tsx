'use client';

import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHydrated } from '@/components/checkin/use-hydrated';
import { Conversation } from '@/components/messages/conversation';
import { DockedPanelScope } from '@/components/messages/panel';
import { useChannels, useSpaceChannel } from '@/lib/messaging-api';
import { cn } from '@/lib/utils';

const KEY = 'space-chat:open';

/** Whether the docked chat is open, remembered in this browser. */
export function useDockedChat() {
  const [open, setOpenState] = useState(false);
  useEffect(() => {
    try {
      setOpenState(localStorage.getItem(KEY) === '1');
    } catch {
      /* storage unavailable: it just starts closed */
    }
  }, []);
  const setOpen = (v: boolean) => {
    setOpenState(v);
    try {
      localStorage.setItem(KEY, v ? '1' : '0');
    } catch {
      /* not remembered */
    }
  };
  return { open, setOpen };
}

/** The button in a space's header that opens or closes the docked chat. */
export function DockedChatButton({
  spaceKey,
  open,
  onToggle,
}: {
  spaceKey: string;
  open: boolean;
  onToggle: () => void;
}) {
  const hydrated = useHydrated();
  const channel = useSpaceChannel(spaceKey, hydrated).data;
  const mine = useChannels().data?.find((c) => c.id === channel?.id);
  const unread = hydrated ? (mine?.unread ?? 0) : 0;
  return (
    <Button
      variant={open ? 'secondary' : 'outline'}
      size="sm"
      aria-pressed={open}
      onClick={onToggle}
    >
      <MessageSquare />
      Chat
      {unread > 0 && !open && (
        <span className="bg-destructive h-4 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-semibold text-white tabular-nums">
          {unread > 99 ? '99+' : unread}
          <span className="sr-only"> unread messages</span>
        </span>
      )}
    </Button>
  );
}

/**
 * The space's channel in a panel on the right, so people can talk while looking at the board. On wide
 * screens it sits beside the page; on narrow ones it covers the right side.
 */
export function DockedChat({
  spaceKey,
  spaceName,
  onClose,
}: {
  spaceKey: string;
  spaceName: string;
  onClose: () => void;
}) {
  const channel = useSpaceChannel(spaceKey);
  return (
    <aside
      aria-label={`${spaceName} chat`}
      className={cn(
        'bg-background fixed top-14 right-0 bottom-0 z-30 flex w-full max-w-[400px] flex-col border-l shadow-lg',
        'xl:shadow-none',
      )}
    >
      <div className="min-h-0 flex-1">
        {channel.isLoading ? (
          <p className="text-muted-foreground p-4 text-sm" role="status">
            Opening chat…
          </p>
        ) : channel.data ? (
          <DockedPanelScope>
            <Conversation channelId={channel.data.id} docked onClose={onClose} />
          </DockedPanelScope>
        ) : (
          <p className="text-muted-foreground p-4 text-sm">This space has no chat you can open.</p>
        )}
      </div>
    </aside>
  );
}
