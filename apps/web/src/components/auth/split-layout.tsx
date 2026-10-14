import Link from 'next/link';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { PhotoPanel, type PanelVariant } from './photo-panel';

/**
 * Signed-out screens: a photo panel beside the task. On phones the photo becomes a short banner
 * above it. `top` is the small contextual link in the corner ("Already have a workspace? Sign in").
 */
export function SplitLayout({
  variant,
  top,
  children,
}: {
  variant: PanelVariant;
  top?: { text: string; label: string; href: string };
  children: ReactNode;
}) {
  return (
    <div className="bg-page min-h-svh lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside aria-label="About Crew Deck" className="hidden lg:sticky lg:top-0 lg:block lg:h-svh">
        <PhotoPanel variant={variant} />
      </aside>
      <div className="h-36 sm:h-44 lg:hidden">
        <PhotoPanel variant={variant} compact />
      </div>
      <div className="flex min-h-0 flex-col lg:min-h-svh">
        <header className="flex items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <span className="text-muted-foreground text-sm">
            {top && (
              <>
                {top.text}{' '}
                <Link
                  href={top.href}
                  className="text-primary font-medium underline underline-offset-4"
                >
                  {top.label}
                </Link>
              </>
            )}
          </span>
          <ThemeToggle />
        </header>
        <main
          id="main"
          className="flex flex-1 items-start justify-center px-5 pb-16 sm:px-8 lg:items-center"
        >
          <div className="animate-fade-up w-full max-w-md py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
