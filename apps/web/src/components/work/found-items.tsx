'use client';

import { formatDue, type WorkItem } from '@/lib/work';
import type { FoundItem } from '@/lib/work-find-api';
import { cn } from '@/lib/utils';
import { useOpenItem } from './item-sheet';
import { PriorityIcon, StatusChip, TypeIcon, UserAvatar } from './work-bits';

/** A compact list of items from any spaces (search results, My work). Clicking opens the side panel. */
export function FoundItems({ items, showSpace = true }: { items: (FoundItem | WorkItem)[]; showSpace?: boolean }) {
  const open = useOpenItem();
  return (
    <ul className="bg-card divide-y rounded-xl border">
      {items.map((i) => (
        <li key={i.id} className="flex items-center gap-3 px-3 py-2 text-sm">
          <TypeIcon type={i.type} />
          <span className="text-muted-foreground w-24 shrink-0 tabular-nums">{i.key}</span>
          <button
            type="button"
            onClick={() => open(i.key)}
            className={cn('min-w-0 flex-1 truncate text-left font-medium hover:underline', i.status.category === 'done' && 'text-muted-foreground')}
          >
            {i.title}
          </button>
          {showSpace && 'spaceName' in i && i.spaceName && (
            <span className="text-muted-foreground hidden max-w-40 truncate text-xs md:inline">{i.spaceName}</span>
          )}
          {i.dueDate && <span className="text-muted-foreground hidden text-xs sm:inline">Due {formatDue(i.dueDate)}</span>}
          <PriorityIcon priority={i.priority} />
          <StatusChip name={i.status.name} category={i.status.category} color={i.status.color} className="hidden sm:inline-flex" />
          <UserAvatar person={i.assignee} size={20} />
        </li>
      ))}
    </ul>
  );
}
