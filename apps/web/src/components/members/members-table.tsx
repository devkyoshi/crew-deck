'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
} from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Search,
  UserX,
  Users,
  X,
} from 'lucide-react';
import { PersonAvatar } from '@/components/messages/person-avatar';
import { useTrackPeople } from '@/components/messages/profile-popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RoleBadge, StatusChip } from '@/components/shared/badges';
import { EmptyState } from '@/components/shared/empty-state';
import { useMe } from '@/components/shell/me-context';
import { api, qs, type Member, type OrgRole, type Page } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { actionsFor, useMemberActions } from './use-member-actions';

const PAGE_SIZE = 10;
type SortKey = 'name' | 'role' | 'status' | 'lastLoginAt';

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function SortHeader({
  label,
  id,
  sort,
  onSort,
}: {
  label: string;
  id: SortKey;
  sort: { id: SortKey; desc: boolean };
  onSort: (id: SortKey) => void;
}) {
  const active = sort.id === id;
  const Icon = !active ? ArrowUpDown : sort.desc ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      onClick={() => onSort(id)}
      className="hover:text-foreground -ml-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5"
      aria-label={`Sort by ${label}`}
    >
      {label}
      <Icon className={cn('size-3.5', !active && 'opacity-50')} aria-hidden />
    </button>
  );
}

export function MembersTable({ admin }: { admin: boolean }) {
  const me = useMe();
  const { setRole, setActive } = useMemberActions();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [role, setRoleFilter] = useState<OrgRole | 'all'>('all');
  const [status, setStatus] = useState<'all' | 'active' | 'deactivated'>('all');
  const [sort, setSort] = useState<{ id: SortKey; desc: boolean }>({ id: 'name', desc: false });
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [confirm, setConfirm] = useState<{ ids: string[]; deactivate: boolean } | null>(null);

  // Any change to the filters starts again from the first page and clears the selection.
  useEffect(() => {
    setPage(1);
    setSelection({});
  }, [q, role, status, sort]);

  const params = {
    q,
    role: role === 'all' ? undefined : role,
    status: admin && status !== 'all' ? status : undefined,
    sort: sort.id,
    dir: sort.desc ? 'desc' : 'asc',
    page,
    pageSize: PAGE_SIZE,
  };
  const query = useQuery({
    queryKey: ['members', params],
    queryFn: () => api<Page<Member>>(`/members${qs(params)}`),
    placeholderData: keepPreviousData,
  });

  const toggleSort = (id: SortKey) =>
    setSort((s) => (s.id === id ? { id, desc: !s.desc } : { id, desc: false }));

  const columns = useMemo<ColumnDef<Member>[]>(() => {
    const cols: ColumnDef<Member>[] = [];
    if (admin) {
      cols.push({
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all on this page"
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && 'indeterminate')
            }
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={`Select ${row.original.name ?? row.original.email}`}
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
          />
        ),
      });
    }
    cols.push(
      {
        id: 'name',
        header: () => <SortHeader label="Member" id="name" sort={sort} onSort={toggleSort} />,
        cell: ({ row }) => {
          const m = row.original;
          return (
            <Link href={`/people/${m.id}`} className="group flex items-center gap-3">
              <PersonAvatar person={m} />
              <span className="min-w-0">
                <span className="block truncate font-medium group-hover:underline">
                  {m.name ?? m.email}
                  {m.id === me.user.id && <span className="text-muted-foreground"> (you)</span>}
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  {m.jobTitle ? `${m.jobTitle} · ${m.email}` : m.email}
                </span>
              </span>
            </Link>
          );
        },
      },
      {
        id: 'role',
        header: () => <SortHeader label="Role" id="role" sort={sort} onSort={toggleSort} />,
        cell: ({ row }) => <RoleBadge role={row.original.orgRole} />,
      },
    );
    if (admin) {
      cols.push(
        {
          id: 'status',
          header: () => <SortHeader label="Status" id="status" sort={sort} onSort={toggleSort} />,
          cell: ({ row }) => <StatusChip status={row.original.status} />,
        },
        {
          id: 'lastLoginAt',
          header: () => (
            <SortHeader label="Last active" id="lastLoginAt" sort={sort} onSort={toggleSort} />
          ),
          cell: ({ row }) => (
            <span className="text-muted-foreground">{timeAgo(row.original.lastLoginAt)}</span>
          ),
        },
        {
          id: 'actions',
          header: () => <span className="sr-only">Actions</span>,
          cell: ({ row }) => {
            const m = row.original;
            const a = actionsFor({ id: me.user.id, role: me.orgRole }, m);
            const deactivated = m.status === 'deactivated';
            return (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Actions for ${m.name ?? m.email}`}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem asChild>
                    <Link href={`/people/${m.id}`}>View profile</Link>
                  </DropdownMenuItem>
                  {a.canChangeRole && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-muted-foreground text-xs">
                        Change role
                      </DropdownMenuLabel>
                      {(['owner', 'admin', 'member'] as const)
                        .filter((r) => r !== m.orgRole && (r !== 'owner' || a.canOwn))
                        .map((r) => (
                          <DropdownMenuItem
                            key={r}
                            onSelect={() => setRole.mutate({ id: m.id, orgRole: r })}
                          >
                            Make {r}
                          </DropdownMenuItem>
                        ))}
                    </>
                  )}
                  {a.canToggleActive && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant={deactivated ? 'default' : 'destructive'}
                        onSelect={() => setConfirm({ ids: [m.id], deactivate: !deactivated })}
                      >
                        {deactivated ? 'Reactivate' : 'Deactivate'}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          },
        },
      );
    }
    return cols;
  }, [admin, sort, me.user.id, me.orgRole]);

  const items = query.data?.items ?? [];
  // Colour the presence dots of the people on this page.
  useTrackPeople(items.map((m) => m.id));
  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (m) => m.id,
    manualPagination: true,
    manualSorting: true,
    enableRowSelection: (row) =>
      actionsFor({ id: me.user.id, role: me.orgRole }, row.original).canToggleActive,
    state: { rowSelection: selection },
    onRowSelectionChange: setSelection,
  });

  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedIds = Object.keys(selection).filter((id) => selection[id]);
  const selectedMembers = items.filter((m) => selection[m.id]);
  const filtered = Boolean(q || role !== 'all' || status !== 'all');

  async function runBulk(ids: string[], deactivate: boolean) {
    const results = await Promise.allSettled(
      ids.map((id) => setActive.mutateAsync({ id, active: !deactivate })),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) setSelection({});
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm min-w-48 flex-1">
          <Search className="text-muted-foreground absolute top-3 left-3 size-4" aria-hidden />
          <Input
            className="pl-9"
            placeholder="Search by name, email or title"
            aria-label="Search members"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={role} onValueChange={(v) => setRoleFilter(v as OrgRole | 'all')}>
          <SelectTrigger className="w-36" aria-label="Filter by role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="owner">Owners</SelectItem>
            <SelectItem value="admin">Admins</SelectItem>
            <SelectItem value="member">Members</SelectItem>
          </SelectContent>
        </Select>
        {admin && (
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="w-40" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="deactivated">Deactivated</SelectItem>
            </SelectContent>
          </Select>
        )}
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              setRoleFilter('all');
              setStatus('all');
            }}
          >
            <X /> Clear filters
          </Button>
        )}
      </div>

      {query.isError ? (
        <EmptyState
          icon={UserX}
          title="Could not load members"
          description="Something went wrong while loading the list."
          action={
            <Button variant="outline" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table aria-busy={query.isFetching}>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="bg-muted/40 hover:bg-muted/40">
                  {hg.headers.map((h) => (
                    <TableHead
                      key={h.id}
                      className={cn(
                        h.column.id === 'select' && 'w-10',
                        h.column.id === 'actions' && 'w-12',
                      )}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {query.isPending
                ? Array.from({ length: 6 }, (_, i) => (
                    <TableRow key={i}>
                      {columns.map((c, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-8 w-full max-w-48" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
              {!query.isPending && items.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columns.length} className="p-0">
                    <EmptyState
                      icon={Users}
                      title={filtered ? 'No one matches those filters' : 'No members yet'}
                      description={
                        filtered
                          ? 'Try a different search or clear the filters.'
                          : 'Invite people to get started.'
                      }
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="text-muted-foreground flex items-center justify-between text-sm">
        <span aria-live="polite">
          {query.data ? `${total} ${total === 1 ? 'person' : 'people'}` : ' '}
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

      {admin && selectedIds.length > 0 && (
        <div
          role="region"
          aria-label="Bulk actions"
          className="bg-popover fixed bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg border px-4 py-2.5 shadow-lg"
        >
          <span className="text-sm font-medium">{selectedIds.length} selected</span>
          {selectedMembers.some((m) => m.status !== 'deactivated') && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() =>
                setConfirm({
                  ids: selectedMembers.filter((m) => m.status !== 'deactivated').map((m) => m.id),
                  deactivate: true,
                })
              }
            >
              Deactivate
            </Button>
          )}
          {selectedMembers.some((m) => m.status === 'deactivated') && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setConfirm({
                  ids: selectedMembers.filter((m) => m.status === 'deactivated').map((m) => m.id),
                  deactivate: false,
                })
              }
            >
              Reactivate
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            aria-label="Clear selection"
            onClick={() => setSelection({})}
          >
            <X />
          </Button>
        </div>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.deactivate ? 'Deactivate' : 'Reactivate'} {confirm?.ids.length}{' '}
              {confirm?.ids.length === 1 ? 'person' : 'people'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.deactivate
                ? 'They are signed out immediately and cannot sign in until reactivated. Their history is kept.'
                : 'They will be able to sign in again.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                confirm?.deactivate
                  ? 'bg-destructive hover:bg-destructive/90 text-white'
                  : undefined
              }
              onClick={() => {
                if (confirm) {
                  runBulk(confirm.ids, confirm.deactivate);
                  setSelection({});
                }
              }}
            >
              {confirm?.deactivate ? 'Deactivate' : 'Reactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
