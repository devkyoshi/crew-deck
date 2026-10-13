'use client';

import { ShieldAlert } from 'lucide-react';
import { InviteDialog } from '@/components/members/invite-dialog';
import { MembersTable } from '@/components/members/members-table';
import { PendingInvites } from '@/components/members/pending-invites';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { useIsAdmin } from '@/components/shell/me-context';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function AdminMembersPage() {
  const isAdmin = useIsAdmin();
  if (!isAdmin) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Admins only"
        description="You need to be a workspace admin to manage members."
      />
    );
  }
  return (
    <>
      <PageHeader
        title="Members"
        description="Invite people, change roles and deactivate accounts."
        action={<InviteDialog />}
      />
      <Tabs defaultValue="members" className="space-y-4">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="invites">Pending invites</TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          <MembersTable admin />
        </TabsContent>
        <TabsContent value="invites">
          <PendingInvites />
        </TabsContent>
      </Tabs>
    </>
  );
}
