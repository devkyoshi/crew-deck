'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AtSign,
  Bookmark,
  BellOff,
  ChevronRight,
  FolderPlus,
  GripVertical,
  Hash,
  Lock,
  MailPlus,
  MessageSquare,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Smile,
  SquarePen,
  Star,
  Trash2,
  Users,
  Boxes,
} from 'lucide-react';
import { toast } from 'sonner';
import type { SidebarSectionDTO } from '@crew-deck/shared';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useHydrated } from '@/components/checkin/use-hydrated';
import { useMe } from '@/components/shell/me-context';
import { ApiError } from '@/lib/api';
import {
  conversationName,
  useChannels,
  useReadAll,
  useSectionMutations,
  useSections,
  useThreadsList,
  useUpdateMyMembership,
  type MyChannelDTO,
  useCanCreateChannel,
} from '@/lib/messaging-api';
import { cn } from '@/lib/utils';
import { BrowseChannelsDialog, CreateChannelDialog, NewMessageDialog } from './dialogs';
import { PersonAvatar } from './person-avatar';
import { CheckinPill, useCheckinOf, useTrackPeople } from './profile-popover';

/** A quiet "Remote" / "Onsite" word next to a person's name, when they are in today. */
function DmCheckin({ userId }: { userId: string }) {
  const badge = useCheckinOf(userId);
  return badge ? <CheckinPill badge={badge} className="hidden xl:inline-flex" /> : null;
}

/** One row of the conversation list. Bold when unread; DMs and group DMs also show a count badge. */
export function ConversationListItem({
  channel,
  active,
  selfId,
  href,
  menu,
}: {
  channel: MyChannelDTO;
  active?: boolean;
  selfId: string;
  href?: string;
  /** A menu for this row (star, move, mute), shown on hover and focus. */
  menu?: ReactNode;
}) {
  const isDm = channel.type === 'dm' || channel.type === 'group_dm';
  const name = conversationName(channel, selfId);
  const unread = channel.unread > 0 && !active;
  const muted =
    channel.notificationLevel === 'none' ||
    (!!channel.mutedUntil && new Date(channel.mutedUntil) > new Date());
  // Direct messages show how many are unread; channels show how many mention me.
  const mentions = !isDm && !active ? channel.mentionCount : 0;
  const badge = isDm && unread ? channel.unread : mentions;
  return (
    <div className="group/item relative">
      <Link
        href={href ?? `/messages/${channel.id}`}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'focus-visible:ring-ring/50 flex h-8 items-center gap-2 rounded-md px-2 text-sm outline-none focus-visible:ring-[3px]',
          active
            ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
            : 'hover:bg-muted/70',
          unread && !muted ? 'text-foreground font-semibold' : !active && 'text-muted-foreground',
        )}
      >
        <span className="flex size-6 shrink-0 items-center justify-center">
          {channel.spaceId ? (
            <Boxes className="size-4" aria-label="Space channel" />
          ) : channel.type === 'public' ? (
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
        {channel.type === 'dm' && channel.people?.[0] && (
          <DmCheckin userId={channel.people[0].id} />
        )}
        {muted && (
          <BellOff className="text-muted-foreground size-3.5 shrink-0" aria-label="Muted" />
        )}
        {channel.isArchived && (
          <span className="text-muted-foreground text-xs uppercase">archived</span>
        )}
        {badge > 0 && (
          <span
            className="bg-destructive text-white min-w-5 rounded-full px-1.5 text-center text-xs leading-5 font-semibold tabular-nums"
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
      {menu && (
        <div className="absolute top-1 right-1 opacity-0 transition-opacity group-focus-within/item:opacity-100 group-hover/item:opacity-100 pointer-coarse:opacity-100 has-[[data-state=open]]:opacity-100">
          {menu}
        </div>
      )}
    </div>
  );
}

// ---- Persisted open/closed state -------------------------------------------------------------------------------

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
  handle,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  count: number;
  /** A drag handle (custom sections only). */
  handle?: ReactNode;
}) {
  const [open, setOpen] = usePersistedOpen(`messages:section:${id}`);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/section">
      <div className="flex items-center gap-1 px-1">
        {handle}
        <CollapsibleTrigger className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex min-w-0 flex-1 items-center gap-1 rounded-sm px-1 py-1 text-xs font-semibold tracking-wide uppercase outline-none focus-visible:ring-2">
          <ChevronRight
            className="size-3.5 shrink-0 transition-transform group-data-[state=open]/section:rotate-90"
            aria-hidden
          />
          <span className="truncate">{title}</span>
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

/** A custom section that can be dragged (with the mouse, or with the keyboard on its handle) into a new place. */
function SortableSection({
  id,
  children,
}: {
  id: string;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const handle = (
    <button
      type="button"
      aria-label="Drag to reorder this section (or focus and press Space, then the arrow keys)"
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 cursor-grab rounded-sm p-0.5 opacity-0 outline-none group-focus-within/section:opacity-100 group-hover/section:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 pointer-coarse:opacity-100"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-3.5" />
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'bg-background relative z-10 rounded-md shadow-md')}
    >
      {children(handle)}
    </div>
  );
}

// ---- Row menu -------------------------------------------------------------------------------------------------

function RowMenu({
  channel,
  sections,
  onMove,
  onNewSection,
}: {
  channel: MyChannelDTO;
  sections: SidebarSectionDTO[];
  onMove: (sectionId: string | null) => void;
  onNewSection: () => void;
}) {
  const mine = useUpdateMyMembership(channel.id);
  const mutedNow = !!channel.mutedUntil && new Date(channel.mutedUntil) > new Date();
  const mute = (hours: number | null) => {
    const until = hours === null ? null : new Date(Date.now() + hours * 3600_000).toISOString();
    mine.mutate(
      { mutedUntil: until },
      {
        onSuccess: () => toast.success(until ? 'Muted' : 'Unmuted'),
        onError: () => toast.error('Could not change that'),
      },
    );
  };
  const tomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
    return Math.max(1, Math.round((d.getTime() - Date.now()) / 3600_000));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Options for ${conversationName(channel)}`}
          className="size-6"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          onSelect={() =>
            mine.mutate(
              { isStarred: !channel.isStarred },
              { onError: () => toast.error('Could not change that') },
            )
          }
        >
          <Star /> {channel.isStarred ? 'Remove from starred' : 'Star'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground text-xs">Move to</DropdownMenuLabel>
        <DropdownMenuItem disabled={!channel.sectionId} onSelect={() => onMove(null)}>
          Main list
        </DropdownMenuItem>
        {sections.map((s) => (
          <DropdownMenuItem
            key={s.id}
            disabled={channel.sectionId === s.id}
            onSelect={() => onMove(s.id)}
          >
            {s.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={onNewSection}>
          <FolderPlus /> New section…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {mutedNow ? (
          <DropdownMenuItem onSelect={() => mute(null)}>
            <BellOff /> Unmute
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Mute notifications
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => mute(1)}>
              <BellOff /> For 1 hour
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => mute(tomorrow())}>
              <BellOff /> Until tomorrow morning
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => mute(24 * 365)}>
              <BellOff /> Until I turn it back on
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---- Section name dialog --------------------------------------------------------------------------------------

function SectionNameDialog({
  open,
  title,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initial: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  useEffect(() => {
    if (open) setName(initial);
  }, [open, initial]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Sections group your conversations in the list. Only you see them.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onSubmit(name.trim());
          }}
          className="space-y-4"
        >
          <Input
            autoFocus
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            placeholder="Projects"
            aria-label="Section name"
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- The list ---------------------------------------------------------------------------------------------------

function TopLink({
  href,
  icon,
  label,
  badge,
  onNavigate,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  badge?: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'focus-visible:ring-ring/50 mx-1 flex h-8 items-center gap-2 rounded-md px-2 text-sm outline-none focus-visible:ring-[3px]',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
          : 'text-muted-foreground hover:bg-muted/70',
      )}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {!!badge && badge > 0 && (
        <span
          className="bg-destructive text-white min-w-5 rounded-full px-1.5 text-center text-xs leading-5 font-semibold tabular-nums"
          aria-label={`${badge} unread`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
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
  const channels = useChannels();
  const sectionsQuery = useSections();
  const threads = useThreadsList();
  // The first client render must match the server's (which has no data yet), even if the cache is full.
  const hydrated = useHydrated();
  const readAll = useReadAll();
  const sectionApi = useSectionMutations();
  const [filter, setFilter] = useState('');
  const canCreate = useCanCreateChannel();
  const [dialog, setDialog] = useState<'new' | 'create' | 'browse' | null>(null);
  const [sectionDialog, setSectionDialog] = useState<
    { mode: 'create'; assign?: string } | { mode: 'rename'; section: SidebarSectionDTO } | null
  >(null);
  const sections = useMemo(
    () => (hydrated ? (sectionsQuery.data ?? []) : []),
    [hydrated, sectionsQuery.data],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const { starred, rooms, dms, bySection } = useMemo(() => {
    const all = (channels.data ?? []).filter(
      (c) =>
        !filter.trim() ||
        conversationName(c, me).toLowerCase().includes(filter.trim().toLowerCase()),
    );
    const known = new Set(sections.map((s) => s.id));
    const inSection = (c: MyChannelDTO) => !!c.sectionId && known.has(c.sectionId);
    const byName = (a: MyChannelDTO, b: MyChannelDTO) =>
      conversationName(a, me).localeCompare(conversationName(b, me));
    const recent = (a: MyChannelDTO, b: MyChannelDTO) =>
      (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt);
    const starred = all.filter((c) => c.isStarred).sort(byName);
    const rest = all.filter((c) => !c.isStarred);
    const bySection = new Map<string, MyChannelDTO[]>();
    for (const c of rest.filter(inSection))
      bySection.set(c.sectionId!, [...(bySection.get(c.sectionId!) ?? []), c].sort(byName));
    const main = rest.filter((c) => !inSection(c));
    return {
      starred,
      bySection,
      rooms: main.filter((c) => c.type === 'public' || c.type === 'private').sort(byName),
      dms: main.filter((c) => c.type === 'dm' || c.type === 'group_dm').sort(recent),
    };
  }, [channels.data, filter, me, sections]);

  // Who is online, for the dots next to direct messages.
  const dmPeople = useMemo(
    () =>
      (channels.data ?? []).flatMap((c) =>
        c.type === 'dm' || c.type === 'group_dm' ? (c.people ?? []).map((p) => p.id) : [],
      ),
    [channels.data],
  );
  useTrackPeople(dmPeople);

  const totalUnread = (channels.data ?? []).reduce((n, c) => n + (c.unread > 0 ? 1 : 0), 0);
  const threadUnread = hydrated ? (threads.data ?? []).reduce((n, t) => n + t.unread, 0) : 0;
  const move = (channelId: string, sectionId: string | null) =>
    sectionApi.order.mutate(
      { assign: { [channelId]: sectionId } },
      { onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not move it') },
    );
  const item = (c: MyChannelDTO) => (
    <li key={c.id} onClick={onNavigate}>
      <ConversationListItem
        channel={c}
        active={c.id === activeId}
        selfId={me}
        menu={
          <RowMenu
            channel={c}
            sections={sections}
            onMove={(s) => move(c.id, s)}
            onNewSection={() => setSectionDialog({ mode: 'create', assign: c.id })}
          />
        }
      />
    </li>
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = sections.map((s) => s.id);
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    sectionApi.order.mutate(
      { sections: next },
      { onError: () => toast.error('Could not save the order') },
    );
  };

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
            className="h-8 pl-7 text-label"
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
          <DropdownMenuContent align="end" className="w-60">
            {canCreate && (
              <DropdownMenuItem onSelect={() => setDialog('create')}>
                <Plus /> Create a channel
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => setDialog('browse')}>
              <Search /> Browse channels
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSectionDialog({ mode: 'create' })}>
              <FolderPlus /> New section…
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
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
              Status and do not disturb are in the profile menu at the top right.
            </DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto p-1 pt-2">
        <div className="mb-1 space-y-px">
          <TopLink
            href="/messages/search"
            icon={<Search className="size-4" aria-hidden />}
            label="Search"
            onNavigate={onNavigate}
          />
          <TopLink
            href="/messages/threads"
            icon={<MessageSquare className="size-4" aria-hidden />}
            label="Threads"
            badge={threadUnread}
            onNavigate={onNavigate}
          />
          <TopLink
            href="/messages/activity"
            icon={<AtSign className="size-4" aria-hidden />}
            label="Mentions and reactions"
            onNavigate={onNavigate}
          />
          <TopLink
            href="/messages/saved"
            icon={<Bookmark className="size-4" aria-hidden />}
            label="Saved"
            onNavigate={onNavigate}
          />
        </div>
        {channels.isLoading || !hydrated ? (
          <div className="space-y-2 p-2" aria-hidden>
            {[60, 44, 72, 52, 64, 40].map((w, i) => (
              <div
                key={i}
                className="bg-muted h-6 animate-pulse rounded-sm"
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
            {starred.length > 0 && (
              <Section id="starred" title="Starred" count={starred.length}>
                {starred.map(item)}
              </Section>
            )}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext
                items={sections.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                {sections.map((s, i) => (
                  <SortableSection key={s.id} id={s.id}>
                    {(handle) => (
                      <Section
                        id={`custom-${s.id}`}
                        title={s.name}
                        count={bySection.get(s.id)?.length ?? 0}
                        handle={handle}
                        action={
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`Options for the ${s.name} section`}
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={() => setSectionDialog({ mode: 'rename', section: s })}
                              >
                                <Pencil /> Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={i === 0}
                                onSelect={() =>
                                  sectionApi.order.mutate({
                                    sections: arrayMove(
                                      sections.map((x) => x.id),
                                      i,
                                      i - 1,
                                    ),
                                  })
                                }
                              >
                                Move up
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={i === sections.length - 1}
                                onSelect={() =>
                                  sectionApi.order.mutate({
                                    sections: arrayMove(
                                      sections.map((x) => x.id),
                                      i,
                                      i + 1,
                                    ),
                                  })
                                }
                              >
                                Move down
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() =>
                                  sectionApi.remove.mutate(s.id, {
                                    onSuccess: () => toast.success('Section deleted'),
                                    onError: () => toast.error('Could not delete it'),
                                  })
                                }
                              >
                                <Trash2 /> Delete section
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        }
                      >
                        {(bySection.get(s.id) ?? []).map(item)}
                        {!bySection.get(s.id)?.length && (
                          <li className="text-muted-foreground px-2 py-1.5 text-label">
                            Empty. Use a conversation’s menu to move it here.
                          </li>
                        )}
                      </Section>
                    )}
                  </SortableSection>
                ))}
              </SortableContext>
            </DndContext>
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
                <li className="text-muted-foreground px-2 py-1.5 text-label">
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
                    className="text-muted-foreground hover:text-foreground text-left text-label underline-offset-2 hover:underline"
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
      <SectionNameDialog
        open={!!sectionDialog}
        title={sectionDialog?.mode === 'rename' ? 'Rename section' : 'New section'}
        initial={sectionDialog?.mode === 'rename' ? sectionDialog.section.name : ''}
        onClose={() => setSectionDialog(null)}
        onSubmit={(name) => {
          const d = sectionDialog;
          if (!d) return;
          if (d.mode === 'rename') {
            sectionApi.rename.mutate(
              { id: d.section.id, name },
              {
                onSuccess: () => setSectionDialog(null),
                onError: () => toast.error('Could not rename it'),
              },
            );
          } else {
            sectionApi.create.mutate(name, {
              onSuccess: ({ section }) => {
                if (d.assign) move(d.assign, section.id);
                setSectionDialog(null);
              },
              onError: (e) =>
                toast.error(e instanceof ApiError ? e.message : 'Could not create the section'),
            });
          }
        }}
      />
    </div>
  );
}
