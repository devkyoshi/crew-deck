'use client';

import { Suspense } from 'react';
import { EmptyState } from '@/components/shared/empty-state';
import { useSpace } from '@/components/spaces/space-context';
import { ListView } from '@/components/work/list-view';

export default function TicketsPage() {
  const space = useSpace();
  if (!space.features.includes('tickets')) {
    return (
      <EmptyState
        title="This space does not take tickets"
        description="A space admin can turn tickets on in the board settings."
      />
    );
  }
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
      <ListView ticketsOnly />
    </Suspense>
  );
}
