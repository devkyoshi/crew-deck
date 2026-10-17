import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TONES, type Tone } from './pastel';

/** A headline number with a tinted icon tile and an optional trend line. */
export function StatCard({
  icon: Icon,
  label,
  value,
  trend,
  tone = 'blue',
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  trend?: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div
      className={cn('bg-card flex items-center gap-4 rounded-lg border p-4 shadow-xs', className)}
    >
      <span
        className={cn(
          'flex size-12 shrink-0 items-center justify-center rounded-lg',
          TONES[tone].bg,
          TONES[tone].text,
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="text-display tnum leading-none">{value}</div>
        <div className="text-muted-foreground mt-1.5 truncate text-sm font-medium">{label}</div>
        {trend && <div className="text-success-soft-foreground text-xs font-medium">{trend}</div>}
      </div>
    </div>
  );
}
