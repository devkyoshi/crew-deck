import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A pressable card or chip for single / multi choice (visibility, icon picker, weekdays, ...).
 * Keeps `aria-pressed` for assistive tech, shows a check badge when selected.
 */
function ToggleCard({
  pressed,
  check = true,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'button'>, 'aria-pressed'> & { pressed: boolean; check?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-slot="toggle-card"
      className={cn(
        'hover:bg-accent/60 focus-visible:ring-ring/50 relative rounded-lg border text-left transition-[background-color,border-color,box-shadow] duration-150 outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50',
        pressed && 'border-primary bg-accent ring-primary/25 ring-2',
        className,
      )}
      {...props}
    >
      {children}
      {pressed && check && (
        <span className="bg-primary text-primary-foreground animate-pop absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full">
          <Check className="size-2.5" strokeWidth={3} aria-hidden />
        </span>
      )}
    </button>
  );
}

export { ToggleCard };
