import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/** Soft tinted palettes used across headers, pills and icon tiles. */
export const TONES = {
  blue: {
    bg: 'bg-info-soft ',
    text: 'text-info-soft-foreground ',
    pill: 'bg-info-soft text-info-soft-foreground ',
  },
  orange: {
    bg: 'bg-orange-soft ',
    text: 'text-orange-soft-foreground ',
    pill: 'bg-orange-soft text-orange-soft-foreground ',
  },
  pink: {
    bg: 'bg-danger-soft ',
    text: 'text-danger-soft-foreground ',
    pill: 'bg-danger-soft text-danger-soft-foreground ',
  },
  green: {
    bg: 'bg-success-soft ',
    text: 'text-success-soft-foreground ',
    pill: 'bg-success-soft text-success-soft-foreground ',
  },
  violet: {
    bg: 'bg-violet-soft ',
    text: 'text-violet-soft-foreground ',
    pill: 'bg-violet-soft text-violet-soft-foreground ',
  },
  amber: {
    bg: 'bg-warning-soft ',
    text: 'text-warning-soft-foreground ',
    pill: 'bg-warning-soft text-warning-soft-foreground ',
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

/** Small rounded-sm grey chip with an icon, e.g. "Due: 5 Dec". */
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
  'bg-info-soft text-info-soft-foreground',
  'bg-warning-soft text-warning-soft-foreground',
  'bg-success-soft text-success-soft-foreground',
  'bg-danger-soft text-danger-soft-foreground',
  'bg-violet-soft text-violet-soft-foreground',
];

export function AvatarStack({ names, max = 4 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <div className="flex -space-x-2">
      {shown.map((n, i) => (
        <Avatar key={n} className="ring-card size-7 ring-2">
          <AvatarFallback
            className={cn('text-xs font-medium', AVATAR_TONES[i % AVATAR_TONES.length])}
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
          <AvatarFallback className="text-xs">+{extra}</AvatarFallback>
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
