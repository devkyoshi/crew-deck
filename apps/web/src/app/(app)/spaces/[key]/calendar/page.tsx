'use client';

import { Suspense } from 'react';
import { CalendarView } from '@/components/work/calendar-view';
import { PageSkeleton } from '@/components/shared/skeletons';

export default function CalendarPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CalendarView />
    </Suspense>
  );
}
