'use client';

import { Suspense } from 'react';
import { DocumentsView } from '@/components/work/documents-view';

export default function DocumentsPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
      <DocumentsView />
    </Suspense>
  );
}
