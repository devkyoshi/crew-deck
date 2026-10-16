'use client';

import { Suspense } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { DashboardView } from '@/components/work/dashboard-view';

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Your own tiles: choose what you want to see at a glance." />
      <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
        <DashboardView />
      </Suspense>
    </div>
  );
}
