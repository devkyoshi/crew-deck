import Link from 'next/link';
import { Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

/** Public pages on the bare domain: pricing and sign-up. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
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
            <Link href="/pricing">Pricing</Link>
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
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-5 pb-20">
        {children}
      </main>
    </div>
  );
}
