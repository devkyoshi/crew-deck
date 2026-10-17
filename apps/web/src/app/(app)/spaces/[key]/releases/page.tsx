'use client';

import { Suspense } from 'react';
import { ReleasesView } from '@/components/work/releases-view';
import { ListSkeleton } from '@/components/shared/skeletons';

export default function ReleasesPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <ReleasesView />
    </Suspense>
  );
}
