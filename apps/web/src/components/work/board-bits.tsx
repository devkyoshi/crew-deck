'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronsLeftRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkItemCardSkeleton, type Density } from './work-card';
import { StatusChip, WipBadge } from './work-bits';
import { CATEGORY_META, STATUS_DOT, type StatusCategory, type StatusColor } from '@/lib/work';
import { cn } from '@/lib/utils';
import { useVocabulary } from './use-vocabulary';

const COUNT_TONE: Record<StatusCategory, string> = {
  todo: 'bg-foreground text-background',
  in_progress: 'bg-warning text-foreground',
  done: 'bg-success text-white',
};

/** A column: a rounded-sm lane with a thin category-coloured bar, a sticky header and its own scroll area. */
export function BoardColumn({
  category,
  collapsed = false,
  highlight = false,
  header,
  children,
  footer,
  className,
  density = 'comfortable',
}: {
  category: StatusCategory;
  collapsed?: boolean;
  /** A valid drop target while dragging. */
  highlight?: boolean;
  header: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  density?: Density;
}) {
  return (
    <section
      className={cn(
        'relative flex shrink-0 flex-col overflow-hidden rounded-xl border border-transparent transition-colors',
        collapsed ? 'w-12' : density === 'compact' ? 'w-[260px]' : 'w-[296px]',
        highlight && 'bg-accent border-foreground/20',
        className,
      )}
    >
      <div className="px-1 pt-1 pb-3">{header}</div>
      {!collapsed && (
        <>
          <div className="flex min-h-24 flex-1 flex-col gap-3 overflow-y-auto px-0.5 pb-3">{children}</div>
          {footer && <div className="pb-2">{footer}</div>}
        </>
      )}
    </section>
  );
}

export function ColumnHeader({
  name,
  category,
  color,
  count,
  total,
  wipLimit,
  collapsed = false,
  onToggle,
  menu,
}: {
  name: string;
  category: StatusCategory;
  color: StatusColor;
  /** Cards currently counted for the limit. */
  count: number;
  /** Cards in the column when more than are loaded. */
  total?: number;
  wipLimit?: number | null;
  collapsed?: boolean;
  onToggle?: () => void;
  menu?: ReactNode;
}) {
  const vocab = useVocabulary();
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label={`Expand ${name}, ${vocab.count(total ?? count)}`}
        className="hover:bg-accent flex w-full flex-col items-center gap-3 rounded-md py-2 outline-none focus-visible:ring-2"
      >
        <ChevronsLeftRight className="text-muted-foreground size-4 rotate-90" aria-hidden />
        <span className="bg-secondary rounded-full px-1.5 text-xs font-semibold tabular-nums">
          {total ?? count}
        </span>
        <span className="text-sm font-medium [writing-mode:vertical-rl]">{name}</span>
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2.5">
      <h2 className="min-w-0 truncate text-sm font-semibold">{name}</h2>
      <span
        className={cn(
          'tnum inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
          COUNT_TONE[category],
        )}
        aria-label={vocab.count(total ?? count)}
      >
        {total ?? count}
      </span>
      {wipLimit ? <WipBadge count={count} limit={wipLimit} /> : null}
      <div className="ml-auto flex items-center">
        {onToggle && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onToggle}
            aria-label={`Collapse ${name}`}
          >
            <ChevronsLeftRight className="size-4 -rotate-90" />
          </Button>
        )}
        {menu}
      </div>
    </div>
  );
}

/** "+ Create" at the foot of a column. Enter creates; Shift+Enter creates and keeps the box open. */
export function ColumnCreateRow({
  onCreate,
  placeholder = 'What needs to be done?',
  busy = false,
}: {
  onCreate: (title: string) => Promise<void> | void;
  placeholder?: string;
  busy?: boolean;
}) {
  const vocab = useVocabulary();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground h-10 w-full justify-center rounded-xl border border-dashed text-sm"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" strokeWidth={1.5} /> Create
      </Button>
    );
  }
  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      className="bg-card space-y-1.5 rounded-xl border p-2 shadow-xs"
    >
      <label className="sr-only" htmlFor="inline-create">
        Title of the new {vocab.noun}
      </label>
      <input
        id="inline-create"
        ref={ref}
        value={title}
        disabled={busy}
        maxLength={255}
        placeholder={placeholder}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            setTitle('');
          } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            const t = title.trim();
            if (!t) return;
            const keepOpen = e.shiftKey;
            setTitle('');
            if (!keepOpen) setOpen(false);
            await onCreate(t);
            if (keepOpen) ref.current?.focus();
          }
        }}
        className="w-full bg-transparent px-1 text-sm outline-none"
      />
      <p className="text-muted-foreground px-1 text-xs">
        Enter to create · Shift+Enter to add another · Esc to cancel
      </p>
    </form>
  );
}

/** Insertion line shown between cards while dragging. */
export function DropIndicator() {
  return <div aria-hidden className="bg-primary -my-1 h-0.5 rounded-full" />;
}

export function ColumnSkeleton({ density = 'comfortable' }: { density?: Density }) {
  return (
    <div
      aria-hidden
      className={cn(
        'shrink-0 space-y-3 rounded-xl p-1 pt-1',
        density === 'compact' ? 'w-[264px]' : 'w-[288px]',
      )}
    >
      <div className="flex items-center gap-2 px-1 pb-1">
        <Skeleton className="size-4 rounded-sm" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="ml-auto h-4 w-6" />
      </div>
      {[0, 1, 2].map((i) => (
        <WorkItemCardSkeleton key={i} density={density} />
      ))}
    </div>
  );
}

/** What the side panel looks like while the item loads. Same two-column geometry as the real thing. */
export function ItemPanelSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading work item" className="space-y-6 p-6">
      <div className="flex items-center gap-2">
        <Skeleton className="size-5 rounded-sm" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="ml-auto size-8 rounded-md" />
      </div>
      <div className="grid gap-6 md:grid-cols-[1fr_240px]">
        <div className="space-y-5">
          <Skeleton className="h-8 w-4/5" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
        <div className="space-y-4">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-8 w-full rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export { StatusChip };
