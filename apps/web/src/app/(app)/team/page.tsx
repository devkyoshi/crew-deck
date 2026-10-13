'use client';

import { PageHeader } from '@/components/shared/page-header';
import { TeamBoard } from '@/components/checkin/team-board';

export default function TeamPage() {
  return (
    <>
      <PageHeader
        title="Team"
        description="Who is working where today. Exact times are only shown to the person, their manager and admins."
      />
      <TeamBoard />
    </>
  );
}
