'use client';

import { Suspense } from 'react';
import { BacklogView } from '@/components/work/backlog-view';
import { ListSkeleton } from '@/components/shared/skeletons';

export default function Page() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <BacklogView />
    </Suspense>
  );
}
