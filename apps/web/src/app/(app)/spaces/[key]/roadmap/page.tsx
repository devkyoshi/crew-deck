'use client';

import { Suspense } from 'react';
import { RoadmapView } from '@/components/work/roadmap-view';
import { PageSkeleton } from '@/components/shared/skeletons';

export default function RoadmapPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RoadmapView />
    </Suspense>
  );
}
