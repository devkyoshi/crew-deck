'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { LogOut, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/platform', label: 'Workspaces' },
  { href: '/platform/settings', label: 'Settings' },
];

/** The platform console: separate from every workspace, only on the bare domain. */
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useQuery({
    queryKey: ['platform-me'],
    queryFn: () => api<{ admin: { email: string } }>('/platform/me'),
    retry: false,
  });

  async function signOut() {
    await api('/platform/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
    router.replace('/platform/sign-in');
  }

  return (
    <div className="bg-page flex min-h-svh flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6">
            <Link href="/platform" className="flex items-center gap-2 text-sm font-semibold">
              <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md">
                <ShieldCheck className="size-3.5" aria-hidden />
              </span>
              Crew Deck platform
            </Link>
            <nav aria-label="Platform" className="flex gap-1">
              {LINKS.map((l) => {
                const active =
                  l.href === '/platform'
                    ? pathname === '/platform' || pathname.startsWith('/platform/tenants')
                    : pathname.startsWith(l.href);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-sm',
                      active
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground hidden text-sm sm:inline">
              {me.data?.admin.email}
            </span>
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="size-4" aria-hidden /> Sign out
            </Button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
