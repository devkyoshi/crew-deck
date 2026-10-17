'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Inbox, Plus, X } from 'lucide-react';
import { toast } from '@/lib/toast';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { TonePill } from '@/components/shared/pastel';
import { errorText } from '@/components/members/use-member-actions';
import { initials } from '@/components/shell/me-context';
import { SpaceIcon } from '@/components/spaces/space-bits';
import { api, qs, type AccessRequest, type Page, type SpaceRole } from '@/lib/api';
import { timeAgo } from '@/lib/format';

const STATUS_TONE = {
  pending: 'amber',
  approved: 'green',
  declined: 'pink',
  cancelled: 'violet',
} as const;
const statusText = (r: AccessRequest) =>
  r.status[0]!.toUpperCase() +
  r.status.slice(1) +
  (r.status === 'approved' && r.grantedRole ? ` as ${r.grantedRole}` : '');

function useRequests(mine: boolean, status: string) {
  return useQuery({
    queryKey: ['access-requests', { mine, status }],
    queryFn: () =>
      api<Page<AccessRequest>>(
        `/access-requests${qs({ mine: mine ? 'true' : undefined, status, pageSize: 50 })}`,
      ),
    placeholderData: keepPreviousData,
  });
}

export default function AccessRequestsPage() {
  const qc = useQueryClient();
  const [deciding, setDeciding] = useState<AccessRequest | null>(null);
  const [role, setRole] = useState<SpaceRole>('member');
  const inbox = useRequests(false, 'pending');
  const history = useRequests(false, 'all');
  const mine = useRequests(true, 'all');

  const refresh = () => qc.invalidateQueries({ queryKey: ['access-requests'] });
  const approve = useMutation({
    mutationFn: (v: { id: string; role: SpaceRole }) =>
      api(`/access-requests/${v.id}/approve`, { body: { role: v.role } }),
    onSuccess: () => {
      toast.success('Access granted');
      setDeciding(null);
      refresh();
      qc.invalidateQueries({ queryKey: ['spaces'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const decline = useMutation({
    mutationFn: (id: string) => api(`/access-requests/${id}/decline`, { body: {} }),
    onSuccess: () => {
      toast.success('Request declined');
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/access-requests/${id}/cancel`, { method: 'POST', body: {} }),
    onSuccess: () => {
      toast.success('Request cancelled');
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const pendingCount = inbox.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="Access requests"
        description="Review who wants into your private spaces, and track your own requests."
        action={
          <Button variant="outline" asChild>
            <Link href="/request-access">
              <Plus /> Request access
            </Link>
          </Button>
        }
      />
      <Tabs defaultValue="review" className="space-y-4">
        <TabsList>
          <TabsTrigger value="review">
            To review{pendingCount > 0 ? ` (${pendingCount})` : ''}
          </TabsTrigger>
          <TabsTrigger value="handled">Handled</TabsTrigger>
          <TabsTrigger value="mine">My requests</TabsTrigger>
        </TabsList>

        <TabsContent value="review">
          <List
            query={inbox}
            empty={{
              title: 'Nothing to review',
              description:
                'When someone asks to join a private space you manage, it shows up here.',
            }}
            render={(r) => (
              <Row key={r.id} r={r}>
                <Button
                  size="sm"
                  onClick={() => {
                    setRole('member');
                    setDeciding(r);
                  }}
                >
                  <Check /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={decline.isPending}
                  onClick={() => decline.mutate(r.id)}
                >
                  <X /> Decline
                </Button>
              </Row>
            )}
          />
        </TabsContent>

        <TabsContent value="handled">
          <List
            query={history}
            filter={(r) => r.status !== 'pending'}
            empty={{
              title: 'Nothing handled yet',
              description: 'Approved and declined requests are listed here.',
            }}
            render={(r) => <Row key={r.id} r={r} showStatus />}
          />
        </TabsContent>

        <TabsContent value="mine">
          <List
            query={mine}
            empty={{
              title: 'No requests',
              description: 'Ask for access to a private space with the Request access button.',
            }}
            render={(r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="font-medium">
                    Space <span className="font-mono">{r.spaceKey}</span>
                  </div>
                  <div className="text-muted-foreground text-xs">Asked {timeAgo(r.createdAt)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <TonePill tone={STATUS_TONE[r.status]}>{statusText(r)}</TonePill>
                  {r.status === 'pending' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(r.id)}
                    >
                      Cancel
                    </Button>
                  )}
                  {r.status === 'approved' && (
                    <Button size="sm" asChild>
                      <Link href={`/spaces/${r.spaceKey}`}>Open</Link>
                    </Button>
                  )}
                </div>
              </li>
            )}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={deciding !== null} onOpenChange={(o) => !o && setDeciding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Approve {deciding?.requesterName ?? deciding?.requesterEmail}?
            </DialogTitle>
            <DialogDescription>
              They get access to {deciding?.spaceName} straight away. Choose their role.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as SpaceRole)}>
              <SelectTrigger className="w-full" aria-label="Role to grant">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member: takes part in the space</SelectItem>
                <SelectItem value="viewer">Viewer: can look, not change</SelectItem>
                <SelectItem value="admin">Admin: manages the space</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>
              Cancel
            </Button>
            <Button
              disabled={approve.isPending}
              onClick={() => deciding && approve.mutate({ id: deciding.id, role })}
            >
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function List({
  query,
  render,
  empty,
  filter,
}: {
  query: ReturnType<typeof useRequests>;
  render: (r: AccessRequest) => ReactNode;
  empty: { title: string; description: string };
  filter?: (r: AccessRequest) => boolean;
}) {
  if (query.isPending) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading requests">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        icon={Inbox}
        title="Could not load requests"
        description="Something went wrong."
        action={
          <Button variant="outline" onClick={() => query.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }
  const items = filter ? query.data.items.filter(filter) : query.data.items;
  if (items.length === 0) return <EmptyState icon={Inbox} {...empty} />;
  return <ul className="divide-y rounded-lg border">{items.map(render)}</ul>;
}

function Row({
  r,
  children,
  showStatus,
}: {
  r: AccessRequest;
  children?: ReactNode;
  showStatus?: boolean;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 p-4">
      <div className="flex min-w-0 items-start gap-3">
        <Avatar className="size-9">
          {r.requesterAvatar && <AvatarImage src={r.requesterAvatar} alt="" />}
          <AvatarFallback className="text-xs">
            {initials(r.requesterName, r.requesterEmail)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="font-medium">{r.requesterName ?? r.requesterEmail}</div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
            wants into
            {r.spaceIcon && (
              <SpaceIcon
                icon={r.spaceIcon}
                spaceKey={r.spaceKey}
                className="size-5 rounded-md [&_svg]:size-3"
              />
            )}
            <Link
              href={`/spaces/${r.spaceKey}`}
              className="text-foreground font-medium hover:underline"
            >
              {r.spaceName ?? r.spaceKey}
            </Link>
            <span className="font-mono">({r.spaceKey})</span> · {timeAgo(r.createdAt)}
          </div>
          {r.message && (
            <p className="bg-muted mt-2 max-w-xl rounded-lg px-3 py-2 text-sm">“{r.message}”</p>
          )}
          {showStatus && (
            <div className="mt-2 flex items-center gap-2">
              <TonePill tone={STATUS_TONE[r.status]}>{statusText(r)}</TonePill>
              {r.decidedByName && (
                <span className="text-muted-foreground text-xs">by {r.decidedByName}</span>
              )}
            </div>
          )}
        </div>
      </div>
      {children && <div className="flex gap-2">{children}</div>}
    </li>
  );
}
