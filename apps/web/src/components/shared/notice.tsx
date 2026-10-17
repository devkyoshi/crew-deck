import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

const VARIANTS = {
  error: {
    icon: AlertCircle,
    box: 'border-destructive/25 bg-destructive/5 text-destructive',
    role: 'alert' as const,
  },
  warning: {
    icon: TriangleAlert,
    box: 'border-warning/30 bg-warning/10 text-warning-soft-foreground ',
    role: 'status' as const,
  },
  info: {
    icon: Info,
    box: 'border-info/25 bg-info/10 text-info-soft-foreground ',
    role: 'status' as const,
  },
  success: {
    icon: CheckCircle2,
    box: 'border-success/25 bg-success/10 text-success-soft-foreground ',
    role: 'status' as const,
  },
};

/** The one way to show an in-page message: errors, warnings, info and success. */
export function Notice({
  variant = 'info',
  title,
  children,
  action,
  className,
}: {
  variant?: keyof typeof VARIANTS;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const v = VARIANTS[variant];
  const Icon = v.icon;
  return (
    <div
      role={v.role}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm',
        v.box,
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? 'opacity-90' : undefined}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
