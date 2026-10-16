'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bookmark,
  ChevronRight,
  Hash,
  Lock,
  MailPlus,
  MoreHorizontal,
  Plus,
  Search,
  SquarePen,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useHydrated } from '@/components/checkin/use-hydrated';
import { useMe } from '@/components/shell/me-context';
import {
  conversationName,
  useChannels,
  usePresence,
  useReadAll,
  type MyChannelDTO,
} from '@/lib/messaging-api';
import { cn } from '@/lib/utils';
import { BrowseChannelsDialog, CreateChannelDialog, NewMessageDialog } from './dialogs';
import { PersonAvatar } from './person-avatar';
import { useMessaging } from './store';

/** One row of the conversation list. Bold when unread; DMs and group DMs also show a count badge. */
export function ConversationListItem({
  channel,
  active,
  selfId,
  href,
}: {
  channel: MyChannelDTO;
  active?: boolean;
  selfId: string;
  href?: string;
}) {
  const isDm = channel.type === 'dm' || channel.type === 'group_dm';
  const name = conversationName(channel, selfId);
  const unread = channel.unread > 0 && !active;
  const muted = channel.notificationLevel === 'none';
  // Direct messages show how many are unread; channels show how many mention me.
  const mentions = !isDm && !active ? channel.mentionCount : 0;
  const badge = isDm && unread ? channel.unread : mentions;
  return (
    <Link
      href={href ?? `/messages/${channel.id}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'focus-visible:ring-ring/50 group/item flex h-8 items-center gap-2 rounded-md px-2 text-[14px] outline-none focus-visible:ring-[3px]',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
          : 'hover:bg-muted/70',
        unread && !muted ? 'text-foreground font-semibold' : !active && 'text-muted-foreground',
      )}
    >
      <span className="flex size-6 shrink-0 items-center justify-center">
        {channel.type === 'public' ? (
          <Hash className="size-4" aria-hidden />
        ) : channel.type === 'private' ? (
          <Lock className="size-3.5" aria-hidden />
        ) : channel.type === 'group_dm' ? (
          <Users className="size-4" aria-hidden />
        ) : (
          <PersonAvatar person={channel.people?.[0] ?? null} size="sm" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {channel.isArchived && (
        <span className="text-muted-foreground text-[10px] uppercase">archived</span>
      )}
      {badge > 0 && (
        <span
          className="bg-destructive text-destructive-foreground min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold tabular-nums"
          aria-label={isDm ? `${badge} unread` : `${badge} unread mentions`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {!badge && unread && (
        <span
          className="bg-primary size-2 shrink-0 rounded-full"
          role="img"
          aria-label="Unread messages"
        />
      )}
    </Link>
  );
}

function usePersistedOpen(key: string) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      const v = localStorage.getItem(key);
      if (v !== null) setOpen(v === '1');
    } catch {
      /* storage unavailable */
    }
  }, [key]);
  return [
    open,
    (v: boolean) => {
      setOpen(v);
      try {
        localStorage.setItem(key, v ? '1' : '0');
      } catch {
        /* storage unavailable */
      }
    },
  ] as const;
}

function Section({
  id,
  title,
  action,
  children,
  count,
}: {
  id: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  count: number;
}) {
  const [open, setOpen] = usePersistedOpen(`messages:section:${id}`);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/section">
      <div className="flex items-center gap-1 px-1">
        <CollapsibleTrigger className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex flex-1 items-center gap-1 rounded px-1 py-1 text-xs font-semibold tracking-wide uppercase outline-none focus-visible:ring-2">
          <ChevronRight
            className="size-3.5 transition-transform group-data-[state=open]/section:rotate-90"
            aria-hidden
          />
          {title}
          <span className="font-normal normal-case">{count}</span>
        </CollapsibleTrigger>
        {action}
      </div>
      <CollapsibleContent>
        <ul className="space-y-px px-1 pb-2">{children}</ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ConversationList({
  activeId,
  onNavigate,
}: {
  activeId: string | null;
  onNavigate?: () => void;
}) {
  const me = useMe().user.id;
  const pathname = usePathname();
  const channels = useChannels();
  // The first client render must match the server's (which has no data yet), even if the cache is full.
  const hydrated = useHydrated();
  const readAll = useReadAll();
  const [filter, setFilter] = useState('');
  const [dialog, setDialog] = useState<'new' | 'create' | 'browse' | null>(null);

  const { rooms, dms } = useMemo(() => {
    const all = (channels.data ?? []).filter(
      (c) =>
        !filter.trim() ||
        conversationName(c, me).toLowerCase().includes(filter.trim().toLowerCase()),
    );
    const rooms = all
      .filter((c) => c.type === 'public' || c.type === 'private')
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    const dms = all
      .filter((c) => c.type === 'dm' || c.type === 'group_dm')
      .sort((a, b) =>
        (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt),
      );
    return { rooms, dms };
  }, [channels.data, filter, me]);

  // Who is online, for the dots next to direct messages.
  const dmPeople = useMemo(
    () =>
      (channels.data ?? []).flatMap((c) =>
        c.type === 'dm' || c.type === 'group_dm' ? (c.people ?? []).map((p) => p.id) : [],
      ),
    [channels.data],
  );
  const presence = usePresence(dmPeople);
  useEffect(() => {
    const st = useMessaging.getState();
    for (const p of presence.data ?? []) if (!st.presence[p.id]) st.setPresence(p.id, p.state);
  }, [presence.data]);

  const totalUnread = (channels.data ?? []).reduce((n, c) => n + (c.unread > 0 ? 1 : 0), 0);
  const item = (c: MyChannelDTO) => (
    <li key={c.id} onClick={onNavigate}>
      <ConversationListItem channel={c} active={c.id === activeId} selfId={me} />
    </li>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b p-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
            aria-hidden
          />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a conversation"
            aria-label="Find a conversation"
            className="h-8 pl-7 text-[13px]"
          />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="New message"
          onClick={() => setDialog('new')}
        >
          <SquarePen />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setDialog('create')}>
              <Plus /> Create a channel
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog('browse')}>
              <Search /> Browse channels
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={totalUnread === 0}
              onSelect={() =>
                readAll.mutate(undefined, {
                  onSuccess: () => toast.success('Everything marked as read'),
                })
              }
            >
              <MailPlus /> Mark all as read
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto p-1 pt-2">
        <Link
          href="/messages/saved"
          onClick={onNavigate}
          aria-current={pathname === '/messages/saved' ? 'page' : undefined}
          className={cn(
            'focus-visible:ring-ring/50 mx-1 mb-1 flex h-8 items-center gap-2 rounded-md px-2 text-[14px] outline-none focus-visible:ring-[3px]',
            pathname === '/messages/saved'
              ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
              : 'text-muted-foreground hover:bg-muted/70',
          )}
        >
          <Bookmark className="size-4" aria-hidden /> Saved
        </Link>
        {channels.isLoading || !hydrated ? (
          <div className="space-y-2 p-2" aria-hidden>
            {[60, 44, 72, 52, 64, 40].map((w, i) => (
              <div
                key={i}
                className="bg-muted h-6 animate-pulse rounded"
                style={{ width: `${w + 20}%` }}
              />
            ))}
          </div>
        ) : channels.isError ? (
          <div className="p-4 text-center text-sm">
            <p className="text-muted-foreground mb-2">Could not load your conversations.</p>
            <Button size="sm" variant="outline" onClick={() => void channels.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <Section
              id="channels"
              title="Channels"
              count={rooms.length}
              action={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Create or browse channels"
                  onClick={() => setDialog('browse')}
                >
                  <Plus />
                </Button>
              }
            >
              {rooms.map(item)}
              {rooms.length === 0 && (
                <li className="text-muted-foreground px-2 py-1.5 text-[13px]">
                  {filter ? 'No channels match.' : 'You are not in any channels yet.'}
                </li>
              )}
            </Section>
            <Section
              id="dms"
              title="Direct messages"
              count={dms.length}
              action={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="New message"
                  onClick={() => setDialog('new')}
                >
                  <Plus />
                </Button>
              }
            >
              {dms.map(item)}
              {dms.length === 0 && (
                <li className="px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => setDialog('new')}
                    className="text-muted-foreground hover:text-foreground text-left text-[13px] underline-offset-2 hover:underline"
                  >
                    {filter ? 'No conversations match.' : 'Start a conversation'}
                  </button>
                </li>
              )}
            </Section>
          </>
        )}
      </nav>

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
