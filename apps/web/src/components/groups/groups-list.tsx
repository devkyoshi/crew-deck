'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
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
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { EmptyState } from '@/components/shared/empty-state';
import { AvatarStack } from '@/components/shared/pastel';
import { api, qs, type GroupSummary, type Page } from '@/lib/api';
import { errorText } from '@/components/members/use-member-actions';
import { GroupFormDialog } from './group-form-dialog';

const PAGE_SIZE = 10;

export function GroupsList({ admin }: { admin: boolean }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<GroupSummary | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = { q, page, pageSize: PAGE_SIZE };
  const query = useQuery({
    queryKey: ['groups', params],
    queryFn: () => api<Page<GroupSummary>>(`/groups${qs(params)}`),
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/groups/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Group deleted');
      qc.invalidateQueries({ queryKey: ['groups'] });
      qc.invalidateQueries({ queryKey: ['member'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const cols = admin ? 3 : 2;

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="text-muted-foreground absolute top-3 left-3 size-4" aria-hidden />
        <Input
          className="pl-9"
          placeholder="Search groups"
          aria-label="Search groups"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {query.isError ? (
        <EmptyState
          icon={Users}
          title="Could not load groups"
          description="Something went wrong while loading the list."
          action={
            <Button variant="outline" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border">
          <Table aria-busy={query.isFetching}>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Group</TableHead>
                <TableHead>Members</TableHead>
                {admin && (
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
                          <Skeleton className="h-8 w-full max-w-56" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : items.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell>
                        <Link href={`/groups/${g.id}`} className="group block">
                          <span className="font-medium group-hover:underline">{g.name}</span>
                          {g.description && (
                            <span className="text-muted-foreground block max-w-md truncate text-xs">
                              {g.description}
                            </span>
                          )}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <AvatarStack names={g.members.map((m) => m.name ?? m.email)} />
                          <span className="text-muted-foreground text-xs">
                            {g.memberCount} {g.memberCount === 1 ? 'person' : 'people'}
                          </span>
                        </div>
                      </TableCell>
                      {admin && (
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Actions for ${g.name}`}
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                <Link href={`/groups/${g.id}`}>Open</Link>
                              </DropdownMenuItem>
                              <GroupFormDialog
                                group={g}
                                trigger={
                                  <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                    <Pencil /> Edit
                                  </DropdownMenuItem>
                                }
                              />
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => setDeleting(g)}
                              >
                                <Trash2 /> Delete
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
                      title={q ? 'No groups match your search' : 'No groups yet'}
                      description={
                        q
                          ? 'Try a different search.'
                          : admin
                            ? 'Create a group to organise people into teams.'
                            : 'Groups your admins create will show up here.'
                      }
                      action={
                        admin && !q ? (
                          <GroupFormDialog
                            trigger={
                              <Button>
                                <Plus /> New group
                              </Button>
                            }
                          />
                        ) : undefined
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
          {query.data ? `${total} group${total === 1 ? '' : 's'}` : ' '}
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

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The group is removed for everyone. People stay in the workspace, but lose any access
              they had through this group.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() => deleting && remove.mutate(deleting.id)}
            >
              Delete group
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
