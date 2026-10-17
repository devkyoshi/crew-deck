'use client';

import { Suspense } from 'react';
import { ListView } from '@/components/work/list-view';
import { TableSkeleton } from '@/components/shared/skeletons';

export default function ListPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <ListView />
    </Suspense>
  );
}
