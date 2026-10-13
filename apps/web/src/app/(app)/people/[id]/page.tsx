'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FolderKanban, Pencil, UserX, Users } from 'lucide-react';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { RoleBadge, StatusChip } from '@/components/shared/badges';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { ProfileForm, type ProfileValues } from '@/components/members/profile-form';
import { actionsFor, useMemberActions } from '@/components/members/use-member-actions';
import { initials, useIsAdmin, useMe } from '@/components/shell/me-context';
import { api, ApiError, type MemberDetail, type OrgRole } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/format';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

export default function MemberProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMe();
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const { setRole, setActive } = useMemberActions();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const query = useQuery({
    queryKey: ['member', id],
    queryFn: () => api<MemberDetail>(`/members/${id}`),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  });

  if (query.isPending) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading member">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <EmptyState
        icon={UserX}
        title={missing ? 'Member not found' : 'Could not load this member'}
        description={
          missing
            ? 'They may have been removed, or are in another workspace.'
            : 'Something went wrong.'
        }
        action={
          <Button variant="outline" asChild>
            <Link href="/people">Back to people</Link>
          </Button>
        }
      />
    );
  }

  const m = query.data;
  const a = actionsFor({ id: me.user.id, role: me.orgRole }, m);
  const canEdit =
    m.id === me.user.id || (isAdmin && (m.orgRole !== 'owner' || me.orgRole === 'owner'));
  const deactivated = m.status === 'deactivated';

  async function saveProfile(v: ProfileValues) {
    if (m.id === me.user.id) {
      await api('/me', {
        method: 'PATCH',
        body: { name: v.name, jobTitle: v.jobTitle || null, timezone: v.timezone },
      });
    } else {
      await api(`/members/${m.id}`, {
        method: 'PATCH',
        body: { name: v.name, jobTitle: v.jobTitle || null, timezone: v.timezone },
      });
    }
    toast.success('Profile updated');
    setEditing(false);
    qc.invalidateQueries({ queryKey: ['member'] });
    qc.invalidateQueries({ queryKey: ['members'] });
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href={isAdmin ? '/admin/members' : '/people'}>
          <ArrowLeft /> Back
        </Link>
      </Button>

      <PageHeader
        title={m.name ?? m.email}
        description={m.jobTitle ?? undefined}
        action={
          canEdit ? (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit profile
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="flex flex-col items-center gap-3 text-center">
            <Avatar className="size-20">
              {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt="" />}
              <AvatarFallback className="text-xl">{initials(m.name, m.email)}</AvatarFallback>
            </Avatar>
            <div>
              <div className="font-semibold">{m.name ?? m.email}</div>
              <div className="text-muted-foreground text-sm break-all">{m.email}</div>
            </div>
            <div className="flex items-center gap-3">
              <RoleBadge role={m.orgRole} />
              {isAdmin && <StatusChip status={m.status} />}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Row label="Job title">{m.jobTitle ?? '—'}</Row>
                <Row label="Timezone">{m.timezone}</Row>
                <Row label="Joined">{formatDate(m.joinedAt)}</Row>
                {isAdmin && <Row label="Last active">{timeAgo(m.lastLoginAt)}</Row>}
              </dl>
            </CardContent>
          </Card>

          {a.canChangeRole && (
            <Card>
              <CardHeader>
                <CardTitle>Access</CardTitle>
                <CardDescription>
                  The role controls what this person can do across the workspace.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Select
                  value={m.orgRole}
                  onValueChange={(v) => setRole.mutate({ id: m.id, orgRole: v as OrgRole })}
                  disabled={setRole.isPending}
                >
                  <SelectTrigger className="w-56" aria-label="Organisation role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    {a.canOwn && <SelectItem value="owner">Owner</SelectItem>}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-6 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Groups</CardTitle>
              </CardHeader>
              <CardContent>
                {m.groups.length === 0 ? (
                  <EmptyState
                    icon={Users}
                    title="No groups yet"
                    description="This person is not in any group."
                  />
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {m.groups.map((g) => (
                      <li key={g.id}>
                        <Link
                          href={`/groups/${g.id}`}
                          className="bg-violet-100 text-violet-700 hover:bg-violet-200 dark:bg-violet-500/20 dark:text-violet-300 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm"
                        >
                          <Users className="size-3.5" aria-hidden />
                          {g.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Spaces</CardTitle>
              </CardHeader>
              <CardContent>
                <EmptyState
                  icon={FolderKanban}
                  title="No spaces yet"
                  description="Spaces and roles appear here once spaces are added."
                />
              </CardContent>
            </Card>
          </div>

          {a.canToggleActive && (
            <Card className="border-destructive/30">
              <CardHeader>
                <CardTitle>{deactivated ? 'Reactivate account' : 'Deactivate account'}</CardTitle>
                <CardDescription>
                  {deactivated
                    ? 'Let this person sign in to the workspace again.'
                    : 'They are signed out immediately and cannot sign in. Their history is kept.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant={deactivated ? 'outline' : 'destructive'}
                  onClick={() => setConfirm(true)}
                >
                  {deactivated ? 'Reactivate' : 'Deactivate'}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
            <DialogDescription>
              Update how {m.name ?? m.email} appears to teammates.
            </DialogDescription>
          </DialogHeader>
          <ProfileForm
            initial={{ name: m.name ?? '', jobTitle: m.jobTitle ?? '', timezone: m.timezone }}
            onSubmit={saveProfile}
            onCancel={() => setEditing(false)}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deactivated ? 'Reactivate' : 'Deactivate'} {m.name ?? m.email}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deactivated
                ? 'They will be able to sign in again.'
                : 'They will be signed out and blocked from signing in.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                deactivated ? undefined : 'bg-destructive hover:bg-destructive/90 text-white'
              }
              onClick={() => setActive.mutate({ id: m.id, active: deactivated })}
            >
              {deactivated ? 'Reactivate' : 'Deactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
