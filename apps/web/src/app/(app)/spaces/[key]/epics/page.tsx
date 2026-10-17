'use client';

import { Suspense } from 'react';
import { EpicsView } from '@/components/work/epics-view';
import { ListSkeleton } from '@/components/shared/skeletons';

export default function EpicsPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <EpicsView />
    </Suspense>
  );
}
