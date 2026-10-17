import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type PillTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'orange';

const TONE: Record<PillTone, { pill: string; dot: string }> = {
  neutral: { pill: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/60' },
  success: { pill: 'bg-success-soft text-success-soft-foreground', dot: 'bg-success' },
  warning: { pill: 'bg-warning-soft text-warning-soft-foreground', dot: 'bg-warning' },
  danger: { pill: 'bg-danger-soft text-danger-soft-foreground', dot: 'bg-danger' },
  info: { pill: 'bg-info-soft text-info-soft-foreground', dot: 'bg-info' },
  violet: { pill: 'bg-violet-soft text-violet-soft-foreground', dot: 'bg-violet' },
  orange: { pill: 'bg-orange-soft text-orange-soft-foreground', dot: 'bg-orange' },
};

/** A soft status pill, optionally led by a coloured dot ("On progress"). */
export function Pill({
  tone = 'neutral',
  dot = false,
  icon,
  className,
  children,
}: {
  tone?: PillTone;
  dot?: boolean;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-label font-medium whitespace-nowrap [&>svg]:size-3.5',
        t.pill,
        className,
      )}
    >
      {dot && <span className={cn('size-1.5 rounded-full', t.dot)} aria-hidden />}
      {icon}
      {children}
    </span>
  );
}
