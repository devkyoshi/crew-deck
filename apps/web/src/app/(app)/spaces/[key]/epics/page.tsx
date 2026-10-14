'use client';

import { Suspense } from 'react';
import { EpicsView } from '@/components/work/epics-view';

export default function EpicsPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
      <EpicsView />
    </Suspense>
  );
}
