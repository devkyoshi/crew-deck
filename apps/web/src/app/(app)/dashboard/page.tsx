'use client';

import { Suspense } from 'react';
import { DashboardView } from '@/components/work/dashboard-view';
import { PageSkeleton } from '@/components/shared/skeletons';

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <Suspense fallback={<PageSkeleton />}>
        <DashboardView />
      </Suspense>
    </div>
  );
}
