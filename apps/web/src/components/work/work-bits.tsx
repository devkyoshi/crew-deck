import { AlertTriangle, Clock, Lock } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  CATEGORY_META,
  PRIORITY_META,
  STATUS_DOT,
  TYPE_META,
  dueState,
  formatDue,
  initialsOf,
  type ItemType,
  type Person,
  type Priority,
  type StatusCategory,
  type StatusColor,
} from '@/lib/work';
import { cn } from '@/lib/utils';
import { useVocabulary } from './use-vocabulary';

/** The type icon in a small rounded-sm tile. The label is always available to assistive tech. */
export function TypeIcon({
  type,
  size = 'sm',
  className,
}: {
  type: ItemType;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const vocab = useVocabulary();
  const m = TYPE_META[type];
  const Icon = m.icon;
  const label = vocab.typeLabel(type);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm',
        size === 'sm' ? 'size-4' : 'size-5',
        m.tile,
        className,
      )}
    >
      <Icon className={cn(m.text, size === 'sm' ? 'size-3' : 'size-3.5')} aria-hidden />
    </span>
  );
}

export function PriorityIcon({
  priority,
  withLabel = false,
  className,
}: {
  priority: Priority;
  withLabel?: boolean;
  className?: string;
}) {
  const m = PRIORITY_META[priority];
  const Icon = m.icon;
  return (
    <span className={cn('inline-flex items-center gap-1', m.text, className)}>
      <Icon
        className="size-4 shrink-0"
        role="img"
        aria-label={`${m.label} priority`}
        aria-hidden={withLabel}
      />
      {withLabel && <span className="text-xs font-medium">{m.label}</span>}
    </span>
  );
}

/** Status chip: category icon, then name, with the status colour as a small dot. Never colour alone. */
export function StatusChip({
  name,
  category,
  color,
  className,
}: {
  name: string;
  category: StatusCategory;
  color?: StatusColor;
  className?: string;
}) {
  const m = CATEGORY_META[category];
  const Icon = m.icon;
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium',
        m.chip,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{name}</span>
      {color && <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[color])} aria-hidden />}
    </span>
  );
}

export function UserAvatar({
  person,
  size = 24,
  className,
}: {
  person: Pick<Person, 'name' | 'email' | 'avatarUrl'> | null;
  size?: number;
  className?: string;
}) {
  if (!person) {
    return (
      <span
        role="img"
        aria-label="Unassigned"
        title="Unassigned"
        style={{ width: size, height: size }}
        className={cn(
          'text-muted-foreground inline-flex shrink-0 items-center justify-center rounded-full border border-dashed',
          className,
        )}
      >
        <span className="sr-only">Unassigned</span>
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Avatar style={{ width: size, height: size }} className={className}>
          {person.avatarUrl && <AvatarImage src={person.avatarUrl} alt="" />}
          <AvatarFallback className="bg-secondary text-xs font-semibold">
            {initialsOf(person)}
          </AvatarFallback>
        </Avatar>
      </TooltipTrigger>
      <TooltipContent>{person.name ?? person.email}</TooltipContent>
    </Tooltip>
  );
}

export function DueDate({
  date,
  done = false,
  className,
}: {
  date: string;
  done?: boolean;
  className?: string;
}) {
  const state = dueState(date, done);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs tabular-nums',
        state === 'overdue'
          ? 'font-medium text-danger-soft-foreground '
          : state === 'soon'
            ? 'text-warning-soft-foreground '
            : 'text-muted-foreground',
        className,
      )}
    >
      {(state === 'overdue' || state === 'soon') && <Clock className="size-3" aria-hidden />}
      {formatDue(date)}
      {state === 'overdue' && <span className="sr-only"> (overdue)</span>}
    </span>
  );
}

export function EstimatePill({ value }: { value: number }) {
  return (
    <span
      className="bg-secondary text-secondary-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums"
      title={`${value} story points`}
    >
      {value}
      <span className="sr-only"> story points</span>
    </span>
  );
}

/** "3 of 5" in the column header. Over the limit it warns with an icon and words, and never blocks. */
export function WipBadge({ count, limit }: { count: number; limit: number }) {
  const over = count > limit;
  const at = count === limit;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums',
        over
          ? 'bg-warning-soft text-warning-soft-foreground '
          : at
            ? 'bg-secondary text-foreground'
            : 'text-muted-foreground',
      )}
      title={over ? 'Over the work-in-progress limit' : 'Work-in-progress limit'}
    >
      {over && <AlertTriangle className="size-3" aria-hidden />}
      {count} of {limit}
      {over && <span className="sr-only"> (over the limit)</span>}
    </span>
  );
}

export function LockedHint({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      <Lock className="size-3" aria-hidden /> {children}
    </span>
  );
}
