'use client';

import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Star,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
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
import { Label } from '@/components/ui/label';
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
import { EmptyState } from '@/components/shared/empty-state';
import {
  GroupPicker,
  PeoplePicker,
  type PickedGroup,
  type PickedPerson,
} from '@/components/shared/pickers';
import { initials } from '@/components/shell/me-context';
import { errorText } from '@/components/members/use-member-actions';
import {
  api,
  qs,
  type Page,
  type SpaceDetail,
  type SpaceMemberRow,
  type SpaceRole,
} from '@/lib/api';
import { SpaceRolePill } from './space-bits';

const PAGE_SIZE = 10;
const ROLE_HELP: Record<SpaceRole, string> = {
  admin: 'Manages the space and its members',
  member: 'Takes part in the space',
  viewer: 'Can look but not change anything',
};

const MESSAGES: Record<string, string> = {
  last_admin: 'A space needs at least one admin. Make someone else an admin first.',
  archived: 'Restore this space before changing its members.',
};
const fail = (e: unknown) => {
  const code = (e as { code?: string })?.code;
  toast.error(code && MESSAGES[code] ? MESSAGES[code] : errorText(e));
};

export function SpaceMembersPanel({ space }: { space: SpaceDetail }) {
  const qc = useQueryClient();
  const canManage = space.permissions.manageMembers && space.status === 'active';
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SpaceMemberRow | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = { q, page, pageSize: PAGE_SIZE };
  const query = useQuery({
    queryKey: ['space-members', space.id, params],
    queryFn: () => api<Page<SpaceMemberRow>>(`/spaces/${space.id}/members${qs(params)}`),
    placeholderData: keepPreviousData,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['space-members', space.id] });
    qc.invalidateQueries({ queryKey: ['space'] });
    qc.invalidateQueries({ queryKey: ['spaces'] });
    qc.invalidateQueries({ queryKey: ['audit', 'space', space.id] });
  };

  const changeRole = useMutation({
    mutationFn: (v: { id: string; role: SpaceRole }) =>
      api(`/spaces/${space.id}/members/${v.id}`, { method: 'PATCH', body: { role: v.role } }),
    onSuccess: () => {
      toast.success('Role updated');
      refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/spaces/${space.id}/members/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Removed');
      refresh();
    },
    onError: fail,
  });

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const cols = canManage ? 4 : 3;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm min-w-48 flex-1">
          <Search className="text-muted-foreground absolute top-3 left-3 size-4" aria-hidden />
          <Input
            className="pl-9"
            placeholder="Search members"
            aria-label="Search space members"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {canManage && (
          <Button className="ml-auto" onClick={() => setAdding(true)}>
            <Plus /> Add members
          </Button>
        )}
      </div>

      {query.isError ? (
        <EmptyState
          icon={Users}
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
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Effective access</TableHead>
                {canManage && (
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isPending
                ? Array.from({ length: 4 }, (_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: cols }, (_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-8 w-full max-w-48" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : items.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {m.type === 'user' ? (
                            <Avatar className="size-8">
                              {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt="" />}
                              <AvatarFallback className="text-xs">
                                {initials(m.name, m.email ?? '?')}
                              </AvatarFallback>
                            </Avatar>
                          ) : (
                            <span className="bg-violet-soft text-violet-soft-foreground flex size-8 items-center justify-center rounded-full">
                              <Users className="size-4" aria-hidden />
                            </span>
                          )}
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {m.name ?? m.email}
                              {m.role === 'admin' && (
                                <Star
                                  className="fill-warning text-warning ml-1.5 inline size-3.5 align-[-2px]"
                                  role="img"
                                  aria-label="Space admin"
                                />
                              )}
                              {m.type === 'group' && (
                                <span className="text-muted-foreground"> (group)</span>
                              )}
                            </span>
                            <span className="text-muted-foreground block truncate text-xs">
                              {m.type === 'group'
                                ? `${m.memberCount ?? 0} ${m.memberCount === 1 ? 'person' : 'people'}`
                                : m.email}
                              {m.deactivated && ' · deactivated'}
                            </span>
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {canManage ? (
                          <Select
                            value={m.role}
                            onValueChange={(r) =>
                              changeRole.mutate({ id: m.id, role: r as SpaceRole })
                            }
                            disabled={changeRole.isPending}
                          >
                            <SelectTrigger
                              className="h-8 w-32"
                              aria-label={`Role for ${m.name ?? m.email}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="member">Member</SelectItem>
                              <SelectItem value="viewer">Viewer</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <SpaceRolePill role={m.role} />
                        )}
                      </TableCell>
                      <TableCell>
                        {m.type === 'group' ? (
                          <span className="text-muted-foreground text-xs">
                            Everyone in the group
                          </span>
                        ) : m.effectiveRole !== m.role ? (
                          <span className="flex items-center gap-2">
                            <SpaceRolePill role={m.effectiveRole} />
                            <span className="text-muted-foreground text-xs">via group</span>
                          </span>
                        ) : (
                          <SpaceRolePill role={m.effectiveRole} />
                        )}
                      </TableCell>
                      {canManage && (
                        <TableCell>
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
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel className="text-muted-foreground text-xs">
                                Change role
                              </DropdownMenuLabel>
                              {(['admin', 'member', 'viewer'] as const)
                                .filter((r) => r !== m.role)
                                .map((r) => (
                                  <DropdownMenuItem
                                    key={r}
                                    onSelect={() => changeRole.mutate({ id: m.id, role: r })}
                                  >
                                    Make {r}
                                  </DropdownMenuItem>
                                ))}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => setRemoving(m)}
                              >
                                <Trash2 /> Remove from space
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
              {!query.isPending && items.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={cols} className="p-0">
                    <EmptyState
                      icon={Users}
                      title={q ? 'No one matches' : 'No members'}
                      description={
                        q ? 'Try a different search.' : 'Add people or groups to give them access.'
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
        <span aria-live="polite">{query.data ? `${total} with access` : ' '}</span>
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

      <AddMembersDialog space={space} open={adding} onOpenChange={setAdding} onDone={refresh} />

      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name ?? removing?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.type === 'group'
                ? 'Everyone in this group loses the access it gave them (unless they have it another way).'
                : 'They lose access to this space unless they still have it through a group.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() => removing && remove.mutate(removing.id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AddMembersDialog({
  space,
  open,
  onOpenChange,
  onDone,
}: {
  space: SpaceDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [people, setPeople] = useState<PickedPerson[]>([]);
  const [groupsSel, setGroupsSel] = useState<PickedGroup[]>([]);
  const [role, setRole] = useState<SpaceRole>('member');

  const add = useMutation({
    mutationFn: () =>
      api<{ results: { status: string }[] }>(`/spaces/${space.id}/members`, {
        body: {
          members: [
            ...people.map((p) => ({ type: 'user', id: p.id, role })),
            ...groupsSel.map((g) => ({ type: 'group', id: g.id, role })),
          ],
        },
      }),
    onSuccess: (r) => {
      const added = r.results.filter((x) => x.status === 'added').length;
      const dup = r.results.length - added;
      toast.success(`${added} added${dup ? `, ${dup} already had access` : ''}`);
      onDone();
      onOpenChange(false);
    },
    onError: fail,
  });

  useEffect(() => {
    if (open) {
      setPeople([]);
      setGroupsSel([]);
      setRole('member');
    }
  }, [open]);

  const count = people.length + groupsSel.length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add members to {space.name}</DialogTitle>
          <DialogDescription>Choose people or groups, and what they can do.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>People</Label>
            <PeoplePicker value={people} onChange={setPeople} label="People to add" />
          </div>
          <div className="space-y-1.5">
            <Label>Groups</Label>
            <GroupPicker value={groupsSel} onChange={setGroupsSel} label="Groups to add" />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as SpaceRole)}>
              <SelectTrigger className="w-full" aria-label="Role for new members">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['admin', 'member', 'viewer'] as const).map((r) => (
                  <SelectItem key={r} value={r}>
                    {r[0]!.toUpperCase() + r.slice(1)}: {ROLE_HELP[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={count === 0 || add.isPending} onClick={() => add.mutate()}>
            {add.isPending ? 'Adding…' : `Add ${count || ''} ${count === 1 ? 'member' : 'members'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
