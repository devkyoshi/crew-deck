'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Hash, Lock, Minus, MessagesSquare, Search, SquarePen, X } from 'lucide-react';
import { create } from 'zustand';
import { useHydrated } from '@/components/checkin/use-hydrated';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMe } from '@/components/shell/me-context';
import { timeAgo } from '@/lib/format';
import { useChannels, useUnreadSummary } from '@/lib/messaging-api';
import { conversationName } from '@/lib/messaging-logic';
import { cn } from '@/lib/utils';
import { Conversation } from './conversation';
import { DockedPanelScope } from './panel';
import { PersonAvatar } from './person-avatar';

const MAX_WINDOWS = 3;

interface DockState {
  /** Open chat windows, oldest first; `minimized` ones show only their title. */
  windows: { id: string; minimized: boolean }[];
  open: (id: string) => void;
  close: (id: string) => void;
  toggleMin: (id: string) => void;
}

/** The little chat windows at the bottom right, like Messenger. Not remembered across reloads. */
export const useQuickChats = create<DockState>((set) => ({
  windows: [],
  open: (id) =>
    set((s) => {
      const rest = s.windows.filter((w) => w.id !== id);
      return { windows: [...rest, { id, minimized: false }].slice(-MAX_WINDOWS) };
    }),
  close: (id) => set((s) => ({ windows: s.windows.filter((w) => w.id !== id) })),
  toggleMin: (id) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, minimized: !w.minimized } : w)),
    })),
}));

/** The messages button in the top bar: recent conversations in a popover, one click to a chat window. */
export function QuickMessages() {
  const { user } = useMe();
  const hydrated = useHydrated();
  const unread = useUnreadSummary();
  const channels = useChannels();
  const open = useQuickChats((s) => s.open);
  const [isOpen, setIsOpen] = useState(false);
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const list = [...((hydrated ? channels.data : undefined) ?? [])].filter((c) => !c.isArchived);
    list.sort(
      (a, b) =>
        Number(b.unread > 0) - Number(a.unread > 0) ||
        (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''),
    );
    const needle = q.trim().toLowerCase();
    return list
      .map((c) => ({ c, name: conversationName(c, user.id) }))
      .filter((r) => !needle || r.name.toLowerCase().includes(needle))
      .slice(0, 12);
  }, [channels.data, hydrated, q, user.id]);

  const count = unread.dms + unread.channels;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground relative size-9 rounded-lg"
          aria-label={count ? `Quick messages, ${count} unread` : 'Quick messages'}
        >
          <MessagesSquare className="size-[18px]" strokeWidth={1.5} />
          {count > 0 && (
            <span className="bg-danger tnum absolute -top-0.5 -right-0.5 min-w-4 rounded-full px-1 text-center text-xs leading-4 font-semibold text-white">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-[22rem] p-0">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <h2 className="text-heading">Messages</h2>
          <Button variant="ghost" size="icon-sm" asChild aria-label="New message">
            <Link href="/messages" onClick={() => setIsOpen(false)}>
              <SquarePen />
            </Link>
          </Button>
        </div>
        <div className="relative px-3 pb-2">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-2.5 left-5.5 size-4"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="h-9 pl-8"
          />
        </div>
        <ul className="max-h-96 overflow-y-auto border-t p-1.5">
          {rows.length === 0 && (
            <li className="text-muted-foreground px-3 py-8 text-center text-sm">
              {channels.isPending ? 'Loading…' : 'No conversations yet.'}
            </li>
          )}
          {rows.map(({ c, name }) => {
            const dm = c.type === 'dm' || c.type === 'group_dm';
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    open(c.id);
                    setIsOpen(false);
                  }}
                  className="hover:bg-accent flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {dm ? (
                    <PersonAvatar person={c.people?.[0] ?? null} />
                  ) : (
                    <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
                      {c.type === 'private' ? (
                        <Lock className="size-4" aria-hidden />
                      ) : (
                        <Hash className="size-4" aria-hidden />
                      )}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate text-sm',
                        c.unread > 0 ? 'font-semibold' : 'font-medium',
                      )}
                    >
                      {name}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {c.lastMessageAt ? timeAgo(c.lastMessageAt) : 'No messages yet'}
                    </span>
                  </span>
                  {c.unread > 0 && (
                    <span className="bg-primary size-2 shrink-0 rounded-full" aria-hidden />
                  )}
                  {c.unread > 0 && <span className="sr-only">{c.unread} unread</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="border-t p-1.5">
          <Button variant="ghost" size="sm" className="w-full" asChild>
            <Link href="/messages" onClick={() => setIsOpen(false)}>
              See all in Messages
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ChatWindow({ id, minimized }: { id: string; minimized: boolean }) {
  const { user } = useMe();
  const channel = useChannels().data?.find((c) => c.id === id);
  const close = useQuickChats((s) => s.close);
  const toggleMin = useQuickChats((s) => s.toggleMin);
  const name = channel ? conversationName(channel, user.id) : 'Chat';

  return (
    <section
      aria-label={`Chat ${name}`}
      className="bg-background pointer-events-auto flex w-[22rem] flex-col overflow-hidden rounded-t-xl border shadow-pop"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={minimized ? `Expand ${name}` : `Minimise ${name}`}
          onClick={() => toggleMin(id)}
        >
          <Minus />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Close ${name}`}
          onClick={() => close(id)}
        >
          <X />
        </Button>
      </header>
      {!minimized && (
        <div className="h-[28rem] min-h-0">
          <DockedPanelScope>
            <Conversation channelId={id} docked onClose={() => close(id)} />
          </DockedPanelScope>
        </div>
      )}
    </section>
  );
}

/** Mounted once in the app shell. Hidden where the full Messages screen is already open. */
export function QuickChatDock() {
  const pathname = usePathname();
  const windows = useQuickChats((s) => s.windows);
  if (pathname.startsWith('/messages') || windows.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 bottom-0 z-40 hidden items-end gap-3 md:flex">
      {windows.map((w) => (
        <ChatWindow key={w.id} id={w.id} minimized={w.minimized} />
      ))}
    </div>
  );
}
