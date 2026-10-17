import { cn } from '@/lib/utils';

export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'bg-background text-muted-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-sm border px-1 font-sans text-xs font-medium shadow-xs',
        className,
      )}
      {...props}
    />
  );
}
