import type { ReactNode } from 'react';
import { Ban, CheckSquare, CornerLeftUp, GripVertical, ListChecks, Lock } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { LabelChips } from './label-bits';
import { DueDate, EstimatePill, PriorityIcon, TypeIcon, UserAvatar } from './work-bits';
import type { BoardSettings, WorkItem } from '@/lib/work';
import { cn } from '@/lib/utils';

export type Density = 'comfortable' | 'compact';
type Field = BoardSettings['cardFields'][number];
export const ALL_FIELDS: Field[] = ['assignee', 'priority', 'estimate', 'dueDate', 'epic', 'labels', 'subtasks'];

/**
 * One card on the board. The whole card opens the item (through the title button, stretched over the
 * card), while the drag handle and menu are separate buttons so interactive elements never nest.
 */
export function WorkItemCard({
  item,
  density = 'comfortable',
  fields = ALL_FIELDS,
  selected = false,
  dragging = false,
  overlay = false,
  onOpen,
  handle,
  menu,
}: {
  item: WorkItem;
  density?: Density;
  fields?: Field[];
  selected?: boolean;
  /** The card left behind in the column while it is being dragged. */
  dragging?: boolean;
  /** The floating copy that follows the pointer. */
  overlay?: boolean;
  onOpen?: (e: React.MouseEvent) => void;
  handle?: ReactNode;
  menu?: ReactNode;
}) {
  const compact = density === 'compact';
  const show = (f: Field) => fields.includes(f);
  const done = item.status.category === 'done';
  const sub = item.subtasks;
  return (
    <article
      aria-label={`${item.key} ${item.title}`}
      className={cn(
        'group bg-card relative rounded-lg border shadow-soft transition-[transform,box-shadow,border-color] duration-150',
        'hover:-translate-y-px hover:shadow-md focus-within:ring-ring focus-within:ring-2 focus-within:ring-offset-1 focus-within:ring-offset-background',
        compact ? 'p-2' : 'p-3',
        selected && 'border-primary ring-primary/40 ring-2',
        dragging && 'border-dashed opacity-40',
        overlay && 'rotate-[2deg] cursor-grabbing shadow-xl ring-1 ring-black/5 motion-reduce:rotate-0',
      )}
    >
      <div className="flex items-start gap-2">
        <h3
          className={cn(
            'min-w-0 flex-1 leading-snug font-medium break-words',
            compact ? 'text-label' : 'text-sm',
            done && 'text-muted-foreground',
          )}
        >
          <button
            type="button"
            onClick={onOpen}
            data-card-open
            className="line-clamp-2 text-left outline-none after:absolute after:inset-0 after:rounded-lg"
          >
            <span className="sr-only">{item.key}: </span>
            {item.title}
          </button>
        </h3>
        <div
          className={cn(
            'relative z-10 -mt-1 -mr-1 flex shrink-0 items-center opacity-0 transition-opacity',
            'group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100',
            overlay && 'opacity-100',
          )}
        >
          {handle ?? (overlay ? <GripVertical className="text-muted-foreground size-4" aria-hidden /> : null)}
          {menu}
        </div>
      </div>

      {!compact && show('epic') && item.parent?.type === 'epic' && (
        <div className="mt-2 flex">
          <span className="inline-flex max-w-full items-center gap-1 rounded-sm bg-violet-soft px-1.5 py-0.5 text-xs font-medium text-violet-soft-foreground ">
            <CornerLeftUp className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{item.parent.title}</span>
          </span>
        </div>
      )}

      {!compact && show('labels') && item.labels.length > 0 && (
        <div className="mt-2">
          <LabelChips labels={item.labels} />
        </div>
      )}

      <div className={cn('flex items-center gap-2', compact ? 'mt-1.5' : 'mt-2.5')}>
        <TypeIcon type={item.type} />
        <span className="text-muted-foreground font-mono text-xs font-medium whitespace-nowrap tabular-nums">{item.key}</span>
        {show('priority') && <PriorityIcon priority={item.priority} />}
        <div className="ml-auto flex items-center gap-2">
          {show('subtasks') && sub.total > 0 && (
            <span
              className="text-muted-foreground inline-flex items-center gap-1 text-xs tabular-nums"
              title={`${sub.done} of ${sub.total} subtasks done`}
            >
              <ListChecks className="size-3.5" aria-hidden />
              {sub.done}/{sub.total}
              <span className="sr-only"> subtasks done</span>
            </span>
          )}
          {(item.blockedBy ?? 0) > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-1.5 text-xs font-medium text-danger-soft-foreground "
              title={`Blocked by ${item.blockedBy} open ${item.blockedBy === 1 ? 'item' : 'items'}`}
            >
              <Ban className="size-3" aria-hidden />
              {item.blockedBy}
              <span className="sr-only"> open blockers</span>
            </span>
          )}
          {(item.blocks ?? 0) > 0 && (
            <span
              className="text-muted-foreground inline-flex items-center gap-1 text-xs tabular-nums"
              title={`Blocks ${item.blocks} open ${item.blocks === 1 ? 'item' : 'items'}`}
            >
              <Lock className="size-3.5" aria-hidden />
              {item.blocks}
              <span className="sr-only"> items waiting on this</span>
            </span>
          )}
          {(item.checklist?.total ?? 0) > 0 && (
            <span
              className="text-muted-foreground inline-flex items-center gap-1 text-xs tabular-nums"
              title={`${item.checklist!.done} of ${item.checklist!.total} checklist entries done`}
            >
              <CheckSquare className="size-3.5" aria-hidden />
              {item.checklist!.done}/{item.checklist!.total}
              <span className="sr-only"> checklist entries done</span>
            </span>
          )}
          {show('dueDate') && item.dueDate && <DueDate date={item.dueDate} done={done} />}
          {show('estimate') && item.estimate !== null && <EstimatePill value={item.estimate} />}
          {(item.carryOverCount ?? 0) > 0 && (
            <span
              className="rounded-full bg-warning-soft px-1.5 text-xs font-medium text-warning-soft-foreground "
              title={`Carried over from ${item.carryOverCount} sprint${item.carryOverCount === 1 ? '' : 's'}`}
            >
              ↻ {item.carryOverCount}
              <span className="sr-only"> carry-overs</span>
            </span>
          )}
          {show('assignee') && (
            <span className="relative z-10">
              <UserAvatar person={item.assignee} size={compact ? 20 : 24} />
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

/** Same geometry as a real card so nothing shifts when data arrives. */
export function WorkItemCardSkeleton({ density = 'comfortable' }: { density?: Density }) {
  const compact = density === 'compact';
  return (
    <div
      aria-hidden
      className={cn('bg-card rounded-lg border shadow-soft', compact ? 'p-2' : 'space-y-2.5 p-3')}
    >
      <Skeleton className={cn('h-4 w-11/12', compact && 'h-3.5')} />
      {!compact && <Skeleton className="h-4 w-2/3" />}
      <div className={cn('flex items-center gap-2', compact && 'mt-1.5')}>
        <Skeleton className="size-4 rounded-sm" />
        <Skeleton className="h-3 w-14" />
        <Skeleton className="ml-auto size-6 rounded-full" />
      </div>
    </div>
  );
}
