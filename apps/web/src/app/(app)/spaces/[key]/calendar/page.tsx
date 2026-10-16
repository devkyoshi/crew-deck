'use client';

import { Suspense } from 'react';
import { CalendarView } from '@/components/work/calendar-view';

export default function CalendarPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
      <CalendarView />
    </Suspense>
  );
}
