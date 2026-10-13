import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <nav aria-label="Progress">
      <ol className="flex items-center gap-2">
        {steps.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li
              key={label}
              className="flex flex-1 items-center gap-2"
              aria-current={active ? 'step' : undefined}
            >
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
                  done && 'bg-primary text-primary-foreground border-primary',
                  active && 'border-primary text-primary',
                  !done && !active && 'text-muted-foreground',
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span
                className={cn('truncate text-xs', active ? 'font-medium' : 'text-muted-foreground')}
              >
                {label}
              </span>
              {i < steps.length - 1 && <span className="bg-border h-px flex-1" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
