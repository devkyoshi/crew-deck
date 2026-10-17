'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserMinus,
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
import { Input } from '@/components/ui/input';
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
import { PageHeader } from '@/components/shared/page-header';
import { PeoplePicker, type PickedPerson } from '@/components/shared/pickers';
import { GroupFormDialog } from '@/components/groups/group-form-dialog';
import { errorText } from '@/components/members/use-member-actions';
import { initials, useIsAdmin } from '@/components/shell/me-context';
import { api, ApiError, type GroupDetail } from '@/lib/api';

export default function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<PickedPerson[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mq, setMq] = useState('');
  const [mp, setMp] = useState(1);

  const query = useQuery({
    queryKey: ['group', id],
    queryFn: () => api<GroupDetail>(`/groups/${id}`),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  });

  const setMembers = useMutation({
    mutationFn: (userIds: string[]) =>
      api<GroupDetail>(`/groups/${id}/members`, { method: 'PUT', body: { userIds } }),
    onSuccess: (g) => {
      qc.setQueryData(['group', id], g);
      qc.invalidateQueries({ queryKey: ['groups'] });
      qc.invalidateQueries({ queryKey: ['member'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const remove = useMutation({
    mutationFn: () => api(`/groups/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Group deleted');
      qc.invalidateQueries({ queryKey: ['groups'] });
      router.replace(isAdmin ? '/admin/groups' : '/groups');
    },
    onError: (e) => toast.error(errorText(e)),
  });

  if (query.isPending) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading group">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <EmptyState
        icon={Users}
        title={missing ? 'Group not found' : 'Could not load this group'}
        description={missing ? 'It may have been deleted.' : 'Something went wrong.'}
        action={
          <Button variant="outline" asChild>
            <Link href="/groups">Back to groups</Link>
          </Button>
        }
      />
    );
  }

  const g = query.data;
  const memberIds = g.members.map((m) => m.id);
  // Big groups are filtered and paged in the browser so thousands of rows never hit the DOM at once.
  const MEMBER_PAGE = 25;
  const needle = mq.trim().toLowerCase();
  const matching = needle
    ? g.members.filter(
        (m) =>
          (m.name ?? '').toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle),
      )
    : g.members;
  const memberPages = Math.max(1, Math.ceil(matching.length / MEMBER_PAGE));
  const pageMembers = matching.slice(
    (Math.min(mp, memberPages) - 1) * MEMBER_PAGE,
    Math.min(mp, memberPages) * MEMBER_PAGE,
  );

  function openAdd() {
    setPicked([]);
    setAdding(true);
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href={isAdmin ? '/admin/groups' : '/groups'}>
          <ArrowLeft /> Groups
        </Link>
      </Button>

      <PageHeader
        title={g.name}
        description={g.description ?? undefined}
        action={
          isAdmin ? (
            <>
              <GroupFormDialog
                group={g}
                trigger={
                  <Button variant="outline">
                    <Pencil /> Edit
                  </Button>
                }
              />
              <Button variant="outline" onClick={() => setConfirmDelete(true)}>
                <Trash2 /> Delete
              </Button>
              <Button onClick={openAdd}>
                <Plus /> Add members
              </Button>
            </>
          ) : undefined
        }
      />

      {g.members.length > MEMBER_PAGE && (
        <div className="relative max-w-sm">
          <Search className="text-muted-foreground absolute top-3 left-3 size-4" aria-hidden />
          <Input
            className="pl-9"
            placeholder="Search members"
            aria-label="Search group members"
            value={mq}
            onChange={(e) => {
              setMq(e.target.value);
              setMp(1);
            }}
          />
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              {isAdmin && <TableHead>Status</TableHead>}
              {isAdmin && (
                <TableHead className="w-12">
                  <span className="sr-only">Remove</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageMembers.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <Link href={`/people/${m.id}`} className="group flex items-center gap-3">
                    <Avatar className="size-8">
                      {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt="" />}
                      <AvatarFallback className="text-xs">
                        {initials(m.name, m.email)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0">
                      <span className="block truncate font-medium group-hover:underline">
                        {m.name ?? m.email}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {m.jobTitle ? `${m.jobTitle} · ${m.email}` : m.email}
                      </span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell>
                  <RoleBadge role={m.orgRole} />
                </TableCell>
                {isAdmin && (
                  <TableCell>
                    <StatusChip status={m.status} />
                  </TableCell>
                )}
                {isAdmin && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${m.name ?? m.email} from ${g.name}`}
                      disabled={setMembers.isPending}
                      onClick={() =>
                        setMembers.mutate(
                          memberIds.filter((x) => x !== m.id),
                          { onSuccess: () => toast.success(`${m.name ?? m.email} removed`) },
                        )
                      }
                    >
                      <UserMinus />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {g.members.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={isAdmin ? 4 : 2} className="p-0">
                  <EmptyState
                    icon={Users}
                    title="No members yet"
                    description={
                      isAdmin
                        ? 'Add people to start building this team.'
                        : 'Nobody has been added yet.'
                    }
                    action={
                      isAdmin ? (
                        <Button onClick={openAdd}>
                          <Plus /> Add members
                        </Button>
                      ) : undefined
                    }
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {matching.length > MEMBER_PAGE && (
        <div className="text-muted-foreground flex items-center justify-between text-sm">
          <span aria-live="polite">
            {matching.length} {matching.length === 1 ? 'person' : 'people'}
          </span>
          <div className="flex items-center gap-2">
            <span>
              Page {Math.min(mp, memberPages)} of {memberPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous page"
              disabled={mp <= 1}
              onClick={() => setMp((p) => p - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next page"
              disabled={mp >= memberPages}
              onClick={() => setMp((p) => p + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add members to {g.name}</DialogTitle>
            <DialogDescription>People already in the group are not shown as new.</DialogDescription>
          </DialogHeader>
          <PeoplePicker value={picked} onChange={setPicked} lockedIds={[]} label="People to add" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              disabled={picked.length === 0 || setMembers.isPending}
              onClick={() =>
                setMembers.mutate([...new Set([...memberIds, ...picked.map((p) => p.id)])], {
                  onSuccess: () => {
                    toast.success(`${picked.length} added`);
                    setAdding(false);
                  },
                })
              }
            >
              Add {picked.length > 0 ? picked.length : ''}{' '}
              {picked.length === 1 ? 'person' : 'people'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{g.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the group for everyone. People stay in the workspace but lose any access
              they had through it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() => remove.mutate()}
            >
              Delete group
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
