'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Layers } from 'lucide-react';
import { SplitLayout } from '@/components/auth/split-layout';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';

/** Public pages on the bare domain. Sign-up pages get the photo split; pricing gets the full-width header. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname.startsWith('/signup')) {
    const verifying = pathname.startsWith('/signup/verify');
    return (
      <SplitLayout
        variant={verifying ? 'verify' : 'signup'}
        top={{ text: 'Already have a workspace?', label: 'Sign in', href: '/workspaces' }}
      >
        {children}
      </SplitLayout>
    );
  }

  return (
    <div className="bg-page flex min-h-svh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4">
        <Link href="/pricing" className="flex items-center gap-2 text-sm font-semibold">
          <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md">
            <Layers className="size-3.5" aria-hidden />
          </span>
          Crew Deck
        </Link>
        <nav aria-label="Main" className="flex items-center gap-2">
          <Button variant="ghost" asChild>
            <Link href="/pricing" aria-current="page">
              Pricing
            </Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/workspaces">Sign in</Link>
          </Button>
          <Button asChild>
            <Link href="/signup">Start free trial</Link>
          </Button>
          <ThemeToggle />
        </nav>
      </header>
      <main id="main" className="flex-1 pb-20">
        {children}
      </main>
      <footer className="text-muted-foreground border-t px-5 py-6 text-center text-xs">
        Crew Deck. Photos from Unsplash.
      </footer>
    </div>
  );
}
