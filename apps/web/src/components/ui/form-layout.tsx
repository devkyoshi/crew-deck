import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A titled group of related fields. `bordered` frames it; otherwise it is a plain labelled block. */
export function FormSection({
  title,
  description,
  icon: Icon,
  bordered = false,
  className,
  children,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  bordered?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn('space-y-3', bordered && 'bg-muted/30 rounded-lg border p-4', className)}
    >
      <header className="space-y-0.5">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          {Icon && <Icon className="text-muted-foreground size-4" aria-hidden />}
          {title}
        </h3>
        {description && <p className="text-muted-foreground text-xs">{description}</p>}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** Related fields side by side from `sm` up, stacked on phones. */
export function FormRow({
  cols = 2,
  className,
  children,
}: {
  cols?: 2 | 3;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('grid gap-3', cols === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3', className)}>
      {children}
    </div>
  );
}

/** Action row at the end of a form: secondary on the left, primary on the right. */
export function FormActions({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex flex-wrap items-center justify-end gap-2 pt-1', className)}>
      {children}
    </div>
  );
}
