'use client';

import { Suspense } from 'react';
import { ListView } from '@/components/work/list-view';

export default function ListPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
      <ListView />
    </Suspense>
  );
}
