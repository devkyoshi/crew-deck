'use client';

import { useQuery } from '@tanstack/react-query';
import { History, Users } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { AvatarStack } from '@/components/shared/pastel';
import { useIsAdmin, initials } from '@/components/shell/me-context';
import { SpaceRolePill } from '@/components/spaces/space-bits';
import { useSpace } from '@/components/spaces/space-context';
import { api, qs, type Page } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/format';

type AuditItem = {
  id: string;
  action: string;
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
  after: Record<string, unknown> | null;
};

const ACTION_TEXT: Record<string, string> = {
  'space.created': 'created the space',
  'space.updated': 'updated the space',
  'space.archived': 'archived the space',
  'space.restored': 'restored the space',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

export default function SpaceOverviewPage() {
  const space = useSpace();
  const isAdmin = useIsAdmin();

  // The org-wide audit log is admin-only for now; space admins get their own view in Phase 5.
  const activity = useQuery({
    queryKey: ['audit', 'space', space.id],
    queryFn: () =>
      api<Page<AuditItem>>(
        `/audit-logs${qs({ targetType: 'space', target: space.id, pageSize: 5 })}`,
      ),
    enabled: isAdmin,
  });

  const people = space.members.filter((m) => m.type === 'user');
  const groups = space.members.filter((m) => m.type === 'group');

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              {space.memberCount}{' '}
              {space.memberCount === 1 ? 'person or group has' : 'people and groups have'} access.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {space.members.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No members"
                description="Nobody has been added to this space yet."
              />
            ) : (
              <>
                <AvatarStack names={people.map((p) => p.name ?? p.email ?? '?')} max={8} />
                <ul className="divide-y rounded-xl border">
                  {space.members.map((m) => (
                    <li
                      key={`${m.type}:${m.id}`}
                      className="flex items-center justify-between gap-3 p-2.5 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {m.type === 'user' ? (
                          <Avatar className="size-6">
                            {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt="" />}
                            <AvatarFallback className="text-[10px]">
                              {initials(m.name, m.email ?? '?')}
                            </AvatarFallback>
                          </Avatar>
                        ) : (
                          <span className="bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300 flex size-6 items-center justify-center rounded-full">
                            <Users className="size-3.5" aria-hidden />
                          </span>
                        )}
                        <span className="truncate">
                          {m.name ?? m.email}
                          {m.type === 'group' && (
                            <span className="text-muted-foreground"> (group)</span>
                          )}
                        </span>
                      </span>
                      <SpaceRolePill role={m.role} />
                    </li>
                  ))}
                </ul>
                {space.memberCount > space.members.length && (
                  <p className="text-muted-foreground text-xs">
                    Showing {space.members.length} of {space.memberCount}.
                  </p>
                )}
              </>
            )}
            {groups.length === 0 && people.length === 0 ? null : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent changes</CardTitle>
          </CardHeader>
          <CardContent>
            {!isAdmin ? (
              <EmptyState
                icon={History}
                title="Activity is for admins"
                description="Workspace admins can see what changed in this space."
              />
            ) : activity.isPending ? (
              <div className="space-y-2" aria-busy="true">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-2/3" />
              </div>
            ) : activity.isError ? (
              <EmptyState
                icon={History}
                title="Could not load activity"
                description="Try again later."
              />
            ) : activity.data.items.length === 0 ? (
              <EmptyState
                icon={History}
                title="Nothing yet"
                description="Changes to this space will show up here."
              />
            ) : (
              <ul className="space-y-3 text-sm">
                {activity.data.items.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3">
                    <span>
                      <span className="font-medium">
                        {a.actorName ?? a.actorEmail ?? 'Someone'}
                      </span>{' '}
                      {ACTION_TEXT[a.action] ?? a.action}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {timeAgo(a.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Row label="Key">
              <span className="font-mono">{space.key}</span>
            </Row>
            <Row label="Visibility">{space.visibility === 'private' ? 'Private' : 'Open'}</Row>
            <Row label="Status">{space.status === 'archived' ? 'Archived' : 'Active'}</Row>
            <Row label="Your role">
              {space.myRole ? <SpaceRolePill role={space.myRole} /> : 'Workspace admin'}
            </Row>
            <Row label="Created">{formatDate(space.createdAt)}</Row>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
