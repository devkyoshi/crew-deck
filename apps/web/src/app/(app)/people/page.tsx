'use client';

import { MembersTable } from '@/components/members/members-table';
import { PageHeader } from '@/components/shared/page-header';

export default function PeoplePage() {
  return (
    <>
      <PageHeader title="People" description="Everyone in your workspace." />
      <MembersTable admin={false} />
    </>
  );
}
