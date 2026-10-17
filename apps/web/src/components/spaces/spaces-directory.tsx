'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, LayoutGrid, List, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/empty-state';
import { Chip } from '@/components/shared/pastel';
import { api, qs, type Page, type Space } from '@/lib/api';
import {
  ArchivedPill,
  KeyChip,
  SpaceIcon,
  SpaceRolePill,
  StarButton,
  VisibilityPill,
} from './space-bits';
import { Users } from 'lucide-react';

type Filter = 'all' | 'open' | 'private' | 'archived';
type View = 'cards' | 'table';
const PAGE_SIZE = 12;
const VIEW_KEY = 'spaces-view';

export function SpacesDirectory() {
  const [filter, setFilter] = useState<Filter>('all');
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [view, setView] = useState<View>('cards');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === 'cards' || saved === 'table') setView(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const changeView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* storage unavailable */
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = {
    q,
    visibility: filter === 'open' || filter === 'private' ? filter : 'all',
    status: filter === 'archived' ? 'archived' : 'active',
    mine: mine ? 'true' : undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const query = useQuery({
    queryKey: ['spaces', params],
    queryFn: () => api<Page<Space>>(`/spaces${qs(params)}`),
    placeholderData: keepPreviousData,
  });

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(q || mine || filter !== 'all');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={filter}
          onValueChange={(v) => {
            setFilter(v as Filter);
            setPage(1);
          }}
        >
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="private">Private</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Switch
            id="mine"
            checked={mine}
            onCheckedChange={(v) => {
              setMine(v);
              setPage(1);
            }}
          />
          <Label htmlFor="mine">My spaces</Label>
        </div>
        <div className="relative ml-auto min-w-48 max-w-xs flex-1">
          <Search className="text-muted-foreground absolute top-3 left-3 size-4" aria-hidden />
          <Input
            className="pl-9"
            placeholder="Search spaces"
            aria-label="Search spaces"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex rounded-lg border p-0.5" role="group" aria-label="View">
          <Button
            variant={view === 'cards' ? 'secondary' : 'ghost'}
            size="icon"
            className="size-8"
            aria-label="Card view"
            aria-pressed={view === 'cards'}
            onClick={() => changeView('cards')}
          >
            <LayoutGrid />
          </Button>
          <Button
            variant={view === 'table' ? 'secondary' : 'ghost'}
            size="icon"
            className="size-8"
            aria-label="Table view"
            aria-pressed={view === 'table'}
            onClick={() => changeView('table')}
          >
            <List />
          </Button>
        </div>
      </div>

      {query.isError ? (
        <EmptyState
          icon={LayoutGrid}
          title="Could not load spaces"
          description="Something went wrong while loading the list."
          action={
            <Button variant="outline" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        />
      ) : query.isPending ? (
        <div
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          aria-busy="true"
          aria-label="Loading spaces"
        >
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title={filtered ? 'No spaces match' : 'No spaces yet'}
          description={
            filtered
              ? 'Try a different filter or search.'
              : 'Spaces are where your team organises its work. Create the first one.'
          }
          action={
            !filtered ? (
              <Button asChild>
                <Link href="/spaces/new">
                  <Plus /> Create space
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : view === 'cards' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((s) => (
            <Link key={s.id} href={`/spaces/${s.key}`} className="group focus-visible:outline-none">
              <Card className="hover:border-primary/40 group-focus-visible:ring-ring/50 h-full gap-3 p-4 shadow-none transition-colors group-focus-visible:ring-[3px]">
                <div className="flex items-start gap-3">
                  <SpaceIcon icon={s.icon} spaceKey={s.key} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{s.name}</div>
                    <KeyChip spaceKey={s.key} />
                  </div>
                  <StarButton
                    id={s.id}
                    starred={s.starred}
                    name={s.name}
                    className="-mt-1 -mr-1 size-8"
                  />
                </div>
                <p className="text-muted-foreground line-clamp-2 min-h-8 text-xs">
                  {s.description ?? 'No description yet.'}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <VisibilityPill visibility={s.visibility} />
                  {s.status === 'archived' && <ArchivedPill />}
                  {s.myRole && <SpaceRolePill role={s.myRole} />}
                  <span className="ml-auto">
                    <Chip icon={Users}>{s.memberCount}</Chip>
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Space</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Your role</TableHead>
                <TableHead>Members</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Star</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link href={`/spaces/${s.key}`} className="group flex items-center gap-3">
                      <SpaceIcon icon={s.icon} spaceKey={s.key} className="size-8 rounded-lg" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium group-hover:underline">
                          {s.name}
                        </span>
                        <KeyChip spaceKey={s.key} />
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1.5">
                      <VisibilityPill visibility={s.visibility} />
                      {s.status === 'archived' && <ArchivedPill />}
                    </div>
                  </TableCell>
                  <TableCell>
                    {s.myRole ? (
                      <SpaceRolePill role={s.myRole} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.memberCount}</TableCell>
                  <TableCell>
                    <StarButton id={s.id} starred={s.starred} name={s.name} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="text-muted-foreground flex items-center justify-between text-sm">
        <span aria-live="polite">
          {query.data ? `${total} space${total === 1 ? '' : 's'}` : ' '}
        </span>
        <div className="flex items-center gap-2">
          <span>
            Page {page} of {pages}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next page"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
