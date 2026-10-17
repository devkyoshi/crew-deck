import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const WIDTHS = {
  narrow: 'max-w-3xl',
  default: 'max-w-5xl',
  wide: 'max-w-6xl',
} as const;

/** One consistent content width for page bodies, so pages line up as people move between them. */
export function PageContainer({
  width = 'default',
  className,
  children,
}: {
  width?: keyof typeof WIDTHS;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn('mx-auto w-full', WIDTHS[width], className)}>{children}</div>;
}
