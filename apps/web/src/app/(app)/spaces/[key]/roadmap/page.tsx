'use client';

import { Suspense } from 'react';
import { RoadmapView } from '@/components/work/roadmap-view';

export default function RoadmapPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
      <RoadmapView />
    </Suspense>
  );
}
