'use client';

import { Suspense } from 'react';
import { DashboardView } from '@/components/work/dashboard-view';

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
        <DashboardView />
      </Suspense>
    </div>
  );
}
