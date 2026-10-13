'use client';

import { Info, Users } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { initials } from '@/components/shell/me-context';
import { SpaceRolePill } from '@/components/spaces/space-bits';
import { useSpace } from '@/components/spaces/space-context';

/** Read-only for now: adding, removing and changing roles arrive with space access in Phase 5. */
export default function SpaceMembersPage() {
  const space = useSpace();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>People and groups with access to this space.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {space.permissions.manageMembers && (
          <div className="bg-accent text-accent-foreground flex gap-2 rounded-xl p-3 text-sm">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            Adding people, changing roles and removing access arrive in the next phase.
          </div>
        )}
        <ul className="divide-y rounded-xl border">
          {space.members.map((m) => (
            <li
              key={`${m.type}:${m.id}`}
              className="flex items-center justify-between gap-3 p-3 text-sm"
            >
              <span className="flex min-w-0 items-center gap-3">
                {m.type === 'user' ? (
                  <Avatar className="size-8">
                    {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt="" />}
                    <AvatarFallback className="text-xs">
                      {initials(m.name, m.email ?? '?')}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <span className="bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300 flex size-8 items-center justify-center rounded-full">
                    <Users className="size-4" aria-hidden />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.name ?? m.email}</span>
                  <span className="text-muted-foreground block text-xs">
                    {m.type === 'group' ? 'Group' : m.email}
                  </span>
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
      </CardContent>
    </Card>
  );
}
