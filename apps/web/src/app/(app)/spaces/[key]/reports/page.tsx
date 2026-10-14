'use client';

import { Suspense } from 'react';
import { SprintReports } from '@/components/work/sprint-reports';

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
      <SprintReports />
    </Suspense>
  );
}
