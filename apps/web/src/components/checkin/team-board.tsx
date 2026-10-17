'use client';

import { useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, CircleDashed, Search, Users } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { AvatarStack, TonedHeader, TONES, type Tone } from '@/components/shared/pastel';
import { initials } from '@/components/shell/me-context';
import {
  api,
  qs,
  type GroupSummary,
  type Location,
  type Page,
  type Space,
  type TeamItem,
  type TeamStatus,
} from '@/lib/api';
import { LOCATIONS } from '@/lib/locations';
import { cn } from '@/lib/utils';
import { useToday } from './use-today';

const COLUMNS: { id: Location | 'none'; label: string; tone: Tone; icon: typeof Users }[] = [
  {
    id: 'onsite',
    label: LOCATIONS.onsite.label,
    tone: LOCATIONS.onsite.tone,
    icon: LOCATIONS.onsite.icon,
  },
  {
    id: 'remote',
    label: LOCATIONS.remote.label,
    tone: LOCATIONS.remote.tone,
    icon: LOCATIONS.remote.icon,
  },
  {
    id: 'offsite',
    label: LOCATIONS.offsite.label,
    tone: LOCATIONS.offsite.tone,
    icon: LOCATIONS.offsite.icon,
  },
  {
    id: 'leave',
    label: LOCATIONS.leave.label,
    tone: LOCATIONS.leave.tone,
    icon: LOCATIONS.leave.icon,
  },
  {
    id: 'holiday',
    label: LOCATIONS.holiday.label,
    tone: LOCATIONS.holiday.tone,
    icon: LOCATIONS.holiday.icon,
  },
  { id: 'none', label: 'Not checked in', tone: 'amber', icon: CircleDashed },
];

const STATE_LABEL: Record<TeamItem['state'], string> = {
  in: 'In',
  out: 'Out',
  leave: 'On leave',
  holiday: 'Holiday',
  planned: 'Planned',
  none: 'Not yet',
};

export function useTeamStatus(filters: { group?: string; space?: string; q?: string } = {}) {
  const enabled = useToday().data?.enabled !== false;
  return useQuery({
    queryKey: ['team', filters],
    queryFn: () => api<TeamStatus>(`/team/status${qs(filters)}`),
    // "Within seconds": the board polls while it is on screen.
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
    enabled,
  });
}

function Person({ p }: { p: TeamItem }) {
  return (
    <li className={'bg-card flex items-center gap-3 rounded-lg border p-2.5'}>
      <Avatar className="size-8">
        {p.avatarUrl && <AvatarImage src={p.avatarUrl} alt="" />}
        <AvatarFallback className="text-xs">{initials(p.name, p.email)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <Link
          href={`/people/${p.id}`}
          className="block truncate text-sm font-medium hover:underline"
        >
          {p.name ?? p.email}
        </Link>
        <div className="text-muted-foreground truncate text-xs">
          {STATE_LABEL[p.state]}
          {p.siteName ? ` · ${p.siteName}` : ''}
          {p.holiday && p.state === 'holiday' ? ` · ${p.holiday}` : ''}
          {p.checkinAt && p.state === 'in'
            ? ` · since ${new Date(p.checkinAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
            : ''}
        </div>
      </div>
    </li>
  );
}

export function TeamBoard() {
  const [group, setGroup] = useState('all');
  const [space, setSpace] = useState('all');
  const [search, setSearch] = useState('');
  const groups = useQuery({
    queryKey: ['groups', 'filter'],
    queryFn: () => api<Page<GroupSummary>>(`/groups${qs({ pageSize: 100 })}`),
  });
  const spaces = useQuery({
    queryKey: ['spaces', 'filter'],
    queryFn: () => api<Page<Space>>(`/spaces${qs({ pageSize: 100 })}`),
  });
  const board = useTeamStatus({
    group: group === 'all' ? undefined : group,
    space: space === 'all' ? undefined : space,
    q: search.trim() || undefined,
  });

  const items = board.data?.items ?? [];
  const filtered = group !== 'all' || space !== 'all' || search.trim() !== '';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs min-w-48 flex-1">
          <Search className="text-muted-foreground absolute top-3 left-3 size-4" aria-hidden />
          <Input
            className="pl-9"
            placeholder="Search people"
            aria-label="Search the team"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={group} onValueChange={setGroup}>
          <SelectTrigger className="w-44" aria-label="Filter by group">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All groups</SelectItem>
            {groups.data?.items.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={space} onValueChange={setSpace}>
          <SelectTrigger className="w-44" aria-label="Filter by space">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All spaces</SelectItem>
            {spaces.data?.items.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground ml-auto text-xs" aria-live="polite">
          {board.data
            ? `${board.data.total} ${board.data.total === 1 ? 'person' : 'people'} · updates every 15 seconds`
            : ''}
        </span>
      </div>

      {board.isError ? (
        <EmptyState
          icon={Users}
          title="Could not load the board"
          description="Something went wrong while loading the team."
          action={
            <Button variant="outline" onClick={() => board.refetch()}>
              Try again
            </Button>
          }
        />
      ) : board.isPending ? (
        <div
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          aria-busy="true"
          aria-label="Loading the team"
        >
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-64 rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Users}
          title={filtered ? 'No one matches those filters' : 'No one here yet'}
          description={
            filtered
              ? 'Try a different group, space or search.'
              : 'Invite people to see where everyone is working.'
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const people = items.filter((i) => (i.location ?? 'none') === col.id);
            // Quiet columns (holiday) only appear when someone is in them.
            if (people.length === 0 && col.id === 'holiday') return null;
            return (
              <section key={col.id} aria-label={col.label} className="space-y-2">
                <TonedHeader
                  tone={col.tone}
                  icon={col.icon}
                  title={col.label}
                  count={people.length}
                />
                {people.length === 0 ? (
                  <p className="text-muted-foreground px-2 py-3 text-xs">No one</p>
                ) : (
                  <ul className="space-y-2">
                    {people.map((p) => (
                      <Person key={p.id} p={p} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Compact version for the Home page. */
export function TeamWidget() {
  const board = useTeamStatus();
  const items = board.data?.items ?? [];
  if (board.isPending)
    return (
      <Skeleton
        role="status"
        className="h-32 w-full rounded-lg"
        aria-label="Loading team status"
      />
    );
  if (board.isError || !board.data) return null;

  return (
    <Card className="gap-4 p-4 shadow-none">
      <div className="flex items-center justify-between">
        <h2 className="text-heading">Who is where today</h2>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/team">
            Team board <ArrowRight />
          </Link>
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {COLUMNS.filter((c) => c.id !== 'holiday').map((col) => {
          const people = items.filter((i) => (i.location ?? 'none') === col.id);
          const t = TONES[col.tone];
          return (
            <div key={col.id} className="space-y-3 rounded-xl border p-3.5">
              <div className="flex items-center gap-2.5 text-sm font-medium">
                <span className={cn('flex size-8 items-center justify-center rounded-lg', t.bg, t.text)}>
                  <col.icon className="size-4" strokeWidth={1.5} aria-hidden />
                </span>
                {col.label}
                <span className="text-muted-foreground tnum ml-auto text-sm">{people.length}</span>
              </div>
              {people.length > 0 ? (
                <AvatarStack names={people.map((p) => p.name ?? p.email)} max={5} />
              ) : (
                <span className="text-muted-foreground text-xs">No one</span>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
