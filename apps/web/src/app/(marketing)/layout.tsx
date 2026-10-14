'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Layers } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';

/** Public marketing pages on the apex domain. Sign-up pages get the centered layout. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Sign-up is a setup flow: a blank full screen that brings its own stepper, no header or footer.
  if (pathname.startsWith('/signup')) return <>{children}</>;

  const isPricing = pathname === '/pricing';

  return (
    <div className="flex min-h-svh bg-[oklch(0.975_0.007_85)] dark:bg-page flex-col text-foreground transition-colors">
      <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-[oklch(0.975_0.007_85/0.8)] dark:bg-page/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-3.5">
          <Link href="/" className="group flex items-center gap-2.5 text-sm font-semibold tracking-tight">
            <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-xl shadow-xs transition-transform group-hover:scale-105">
              <Layers className="size-4" aria-hidden />
            </span>
            <span className="text-base font-semibold">Crew Deck</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-2 sm:gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/pricing" aria-current={isPricing ? 'page' : undefined}>
                Pricing
              </Link>
            </Button>
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex" asChild>
              <Link href="/workspaces">Find workspace</Link>
            </Button>
            <Button size="sm" className="rounded-xl px-4 font-medium" asChild>
              <Link href="/signup">Start free trial</Link>
            </Button>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1 pb-20">
        {children}
      </main>

      <footer className="border-t border-border/50 bg-card/40 px-5 py-8 text-xs text-muted-foreground">
        <div className="mx-auto max-w-6xl flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="flex size-5 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Layers className="size-3" aria-hidden />
            </span>
            <span className="font-semibold text-foreground">Crew Deck</span>
            <span>&mdash; Modern agile workspace, check-ins, and CRM.</span>
          </div>
          <div className="flex items-center gap-5">
            <Link href="/pricing" className="hover:text-foreground hover:underline underline-offset-4">
              Pricing
            </Link>
            <Link href="/workspaces" className="hover:text-foreground hover:underline underline-offset-4">
              Workspaces
            </Link>
            <Link href="/signup" className="hover:text-foreground hover:underline underline-offset-4">
              Free Trial
            </Link>
            <span className="text-muted-foreground">&copy; {new Date().getFullYear()}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
