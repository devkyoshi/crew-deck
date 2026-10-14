import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/** Soft tinted palettes used across headers, pills and icon tiles. */
export const TONES = {
  blue: {
    bg: 'bg-sky-50 dark:bg-sky-500/10',
    text: 'text-sky-700 dark:text-sky-300',
    pill: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  },
  orange: {
    bg: 'bg-orange-50 dark:bg-orange-500/10',
    text: 'text-orange-700 dark:text-orange-300',
    pill: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
  },
  pink: {
    bg: 'bg-rose-50 dark:bg-rose-500/10',
    text: 'text-rose-700 dark:text-rose-300',
    pill: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  },
  green: {
    bg: 'bg-emerald-50 dark:bg-emerald-500/10',
    text: 'text-emerald-700 dark:text-emerald-300',
    pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  },
  violet: {
    bg: 'bg-violet-50 dark:bg-violet-500/10',
    text: 'text-violet-700 dark:text-violet-300',
    pill: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-500/10',
    text: 'text-amber-700 dark:text-amber-300',
    pill: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  },
} as const;
export type Tone = keyof typeof TONES;

/** Tinted section header with icon, title and count chip (kanban column / group header). */
export function TonedHeader({
  tone,
  icon: Icon,
  title,
  count,
  action,
}: {
  tone: Tone;
  icon: LucideIcon;
  title: string;
  count?: number;
  action?: ReactNode;
}) {
  const t = TONES[tone];
  return (
    <div className={cn('flex items-center gap-2 rounded-lg px-3.5 py-2', t.bg)}>
      <Icon className={cn('size-4', t.text)} aria-hidden />
      <span className="font-medium">{title}</span>
      {count !== undefined && (
        <span className={cn('rounded-md px-1.5 text-xs font-medium', t.pill)}>{count}</span>
      )}
      <div className="ml-auto">{action}</div>
    </div>
  );
}

/** Small rounded grey chip with an icon, e.g. "Due: 5 Dec". */
export function Chip({
  icon: Icon,
  children,
  className,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'bg-muted text-muted-foreground inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs',
        className,
      )}
    >
      {Icon && <Icon className="size-3.5" aria-hidden />}
      {children}
    </span>
  );
}

/** Tinted pill, e.g. priority. */
export function TonePill({
  tone,
  icon: Icon,
  children,
}: {
  tone: Tone;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
        TONES[tone].pill,
      )}
    >
      {Icon && <Icon className="size-3" aria-hidden />}
      {children}
    </span>
  );
}

const AVATAR_TONES = [
  'bg-sky-200 text-sky-900',
  'bg-amber-200 text-amber-900',
  'bg-emerald-200 text-emerald-900',
  'bg-rose-200 text-rose-900',
  'bg-violet-200 text-violet-900',
];

export function AvatarStack({ names, max = 4 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <div className="flex -space-x-2">
      {shown.map((n, i) => (
        <Avatar key={n} className="ring-card size-7 ring-2">
          <AvatarFallback
            className={cn('text-[10px] font-medium', AVATAR_TONES[i % AVATAR_TONES.length])}
          >
            {n
              .split(' ')
              .map((p) => p[0])
              .join('')
              .slice(0, 2)}
          </AvatarFallback>
        </Avatar>
      ))}
      {extra > 0 && (
        <Avatar className="ring-card size-7 ring-2">
          <AvatarFallback className="text-[10px]">+{extra}</AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}

/** Rounded tile that holds an icon. */
export function IconTile({
  tone = 'blue',
  icon: Icon,
  className,
}: {
  tone?: Tone;
  icon: LucideIcon;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-lg',
        TONES[tone].pill,
        className,
      )}
    >
      <Icon className="size-4" aria-hidden />
    </span>
  );
}
