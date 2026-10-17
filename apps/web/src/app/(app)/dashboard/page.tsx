'use client';

import { Suspense } from 'react';
import { DashboardView } from '@/components/work/dashboard-view';
import { PageContainer } from '@/components/shared/page-container';
import { PageSkeleton } from '@/components/shared/skeletons';

export default function DashboardPage() {
  return (
    <PageContainer width="wide">
      <Suspense fallback={<PageSkeleton />}>
        <DashboardView />
      </Suspense>
    </PageContainer>
  );
}
