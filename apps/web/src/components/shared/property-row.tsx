import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A label-and-value row for entity headers: icon + name on the left, the value on the right. */
export function PropertyRow({
  icon: Icon,
  label,
  children,
  className,
}: {
  icon?: LucideIcon;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid min-h-9 grid-cols-[9rem_1fr] items-center gap-3 sm:grid-cols-[11rem_1fr]',
        className,
      )}
    >
      <dt className="text-muted-foreground flex items-center gap-2 text-sm">
        {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
        {label}
      </dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2 text-sm">{children}</dd>
    </div>
  );
}

export function PropertyList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('space-y-0.5', className)}>{children}</dl>;
}
