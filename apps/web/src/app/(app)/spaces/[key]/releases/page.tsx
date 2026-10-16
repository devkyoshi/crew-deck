'use client';

import { Suspense } from 'react';
import { ReleasesView } from '@/components/work/releases-view';

export default function ReleasesPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
      <ReleasesView />
    </Suspense>
  );
}
