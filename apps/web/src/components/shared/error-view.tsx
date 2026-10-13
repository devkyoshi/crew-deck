'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Friendly full-section error with a retry. Used by route error boundaries. */
export function ErrorView({
  error,
  reset,
  home = '/',
}: {
  error: Error & { digest?: string };
  reset: () => void;
  home?: string;
}) {
  useEffect(() => {
    // Surfaces in the browser console and any error reporting added later.
    console.error(error);
  }, [error]);

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center"
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
        <TriangleAlert className="size-6" aria-hidden />
      </span>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-muted-foreground text-sm">
          This page hit an unexpected problem. You can try again, or head back home.
        </p>
        {error.digest && (
          <p className="text-muted-foreground font-mono text-xs">Reference: {error.digest}</p>
        )}
      </div>
      <div className="flex gap-2">
        <Button onClick={reset}>
          <RotateCw /> Try again
        </Button>
        <Button variant="outline" asChild>
          <Link href={home}>Go home</Link>
        </Button>
      </div>
    </div>
  );
}
