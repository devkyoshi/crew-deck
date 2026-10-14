'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Password field with a reveal toggle. Forwards everything (including RHF's ref) to the input. */
function PasswordInput({ className, ref, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  const [shown, setShown] = React.useState(false);
  return (
    <div className="relative">
      <Input
        ref={ref}
        type={shown ? 'text' : 'password'}
        className={cn('pr-9', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide' : 'Show'}
        aria-pressed={shown}
        className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md transition-colors outline-none focus-visible:text-foreground"
      >
        {shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}

export { PasswordInput };
