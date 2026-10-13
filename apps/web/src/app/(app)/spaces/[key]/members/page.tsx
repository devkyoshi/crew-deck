'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SpaceMembersPanel } from '@/components/spaces/space-members-panel';
import { useSpace } from '@/components/spaces/space-context';

export default function SpaceMembersPage() {
  const space = useSpace();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          People and groups with access to this space. A person&apos;s effective access is the
          highest of their own role and any role their groups give them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SpaceMembersPanel space={space} />
      </CardContent>
    </Card>
  );
}
