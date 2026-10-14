'use client';

import { Suspense } from 'react';
import { useSpace } from '@/components/spaces/space-context';
import { ColumnSkeleton } from '@/components/work/board-bits';
import { BoardView } from '@/components/work/board-view';

export default function BoardPage() {
  const space = useSpace();
  return (
    <Suspense
      fallback={
        <div className="flex gap-3 overflow-x-auto" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <ColumnSkeleton key={i} />
          ))}
        </div>
      }
    >
      <BoardView spaceKey={space.key} />
    </Suspense>
  );
}
