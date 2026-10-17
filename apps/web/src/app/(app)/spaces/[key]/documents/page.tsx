'use client';

import { Suspense } from 'react';
import { DocumentsView } from '@/components/work/documents-view';
import { ListSkeleton } from '@/components/shared/skeletons';

export default function DocumentsPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <DocumentsView />
    </Suspense>
  );
}
