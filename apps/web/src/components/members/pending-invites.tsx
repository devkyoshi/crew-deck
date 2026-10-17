'use client';

import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, MailPlus, RotateCw, Trash2 } from 'lucide-react';
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
import { RoleBadge } from '@/components/shared/badges';
import { EmptyState } from '@/components/shared/empty-state';
import { TonePill } from '@/components/shared/pastel';
import { api, qs, type Invitation, type Page } from '@/lib/api';
import { daysUntil, timeAgo } from '@/lib/format';
import { errorText } from './use-member-actions';

const PAGE_SIZE = 10;
type Filter = 'pending' | 'expired' | 'revoked' | 'accepted' | 'all';

export function PendingInvites() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Filter>('pending');
  const [page, setPage] = useState(1);
  const [revoking, setRevoking] = useState<Invitation | null>(null);

  const params = { status, page, pageSize: PAGE_SIZE };
  const query = useQuery({
    queryKey: ['invitations', params],
    queryFn: () => api<Page<Invitation>>(`/invitations${qs(params)}`),
    placeholderData: keepPreviousData,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['invitations'] });

  const resend = useMutation({
    mutationFn: (id: string) =>
      api<{ ok: true; emailDelivery: boolean; link?: string }>(`/invitations/${id}/resend`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: async (r) => {
      refresh();
      if (r.emailDelivery) return toast.success('Invitation sent again');
      try {
        if (r.link) await navigator.clipboard.writeText(r.link);
        toast.success('New invite link copied. Email delivery is not set up.');
      } catch {
        toast.message('New link created', { description: r.link });
      }
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/invitations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Invitation revoked');
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = query.data?.items ?? [];

  return (
    <div className="space-y-4">
      <Select
        value={status}
        onValueChange={(v) => {
          setStatus(v as Filter);
          setPage(1);
        }}
      >
        <SelectTrigger className="w-44" aria-label="Filter invitations">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="expired">Expired</SelectItem>
          <SelectItem value="revoked">Revoked</SelectItem>
          <SelectItem value="accepted">Accepted</SelectItem>
          <SelectItem value="all">All</SelectItem>
        </SelectContent>
      </Select>

      {query.isError ? (
        <EmptyState
          icon={MailPlus}
          title="Could not load invitations"
          description="Something went wrong while loading the list."
          action={
            <Button variant="outline" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Invited by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-48 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isPending
                ? Array.from({ length: 4 }, (_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }, (_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-6 w-full max-w-40" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : items.map((inv) => {
                    const actionable = inv.status === 'pending' || inv.status === 'expired';
                    const left = daysUntil(inv.expiresAt);
                    return (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium">{inv.email}</TableCell>
                        <TableCell>
                          <RoleBadge role={inv.orgRole} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {inv.invitedByName ?? 'Unknown'}
                          <span className="block text-xs">{timeAgo(inv.createdAt)}</span>
                        </TableCell>
                        <TableCell>
                          {inv.status === 'pending' && (
                            <TonePill tone="amber">Expires in {Math.max(left, 0)}d</TonePill>
                          )}
                          {inv.status === 'expired' && <TonePill tone="pink">Expired</TonePill>}
                          {inv.status === 'revoked' && <TonePill tone="violet">Revoked</TonePill>}
                          {inv.status === 'accepted' && <TonePill tone="green">Accepted</TonePill>}
                        </TableCell>
                        <TableCell className="text-right">
                          {actionable && (
                            <div className="flex justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={resend.isPending}
                                onClick={() => resend.mutate(inv.id)}
                              >
                                <RotateCw /> Resend
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Revoke invitation for ${inv.email}`}
                                onClick={() => setRevoking(inv)}
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              {!query.isPending && items.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="p-0">
                    <EmptyState
                      icon={MailPlus}
                      title={status === 'pending' ? 'No pending invitations' : 'Nothing here'}
                      description="Invitations you send show up here until they are accepted."
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
          {query.data ? `${total} invitation${total === 1 ? '' : 's'}` : ' '}
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

      <AlertDialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this invitation?</AlertDialogTitle>
            <AlertDialogDescription>
              The link sent to {revoking?.email} will stop working. You can invite them again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() => revoking && revoke.mutate(revoking.id)}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
