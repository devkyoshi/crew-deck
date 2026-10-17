'use client';

import { InviteDialog } from '@/components/members/invite-dialog';
import { MembersTable } from '@/components/members/members-table';
import { PageHeader } from '@/components/shared/page-header';
import { useIsAdmin } from '@/components/shell/me-context';

export default function PeoplePage() {
  const isAdmin = useIsAdmin();
  return (
    <>
      <PageHeader
        title="People"
        description="Everyone in your workspace."
        action={isAdmin ? <InviteDialog /> : undefined}
      />
      <MembersTable admin={false} />
    </>
  );
}
