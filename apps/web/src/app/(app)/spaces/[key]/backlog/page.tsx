'use client';

import { Suspense } from 'react';
import { BacklogView } from '@/components/work/backlog-view';

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
      <BacklogView />
    </Suspense>
  );
}
