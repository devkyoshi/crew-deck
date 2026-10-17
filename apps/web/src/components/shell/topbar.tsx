'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment, useEffect } from 'react';
import { useRecentSpaces } from '@/lib/recent-spaces';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { CheckinControl } from '@/components/checkin/checkin-control';
import { CommandPalette } from './command-palette';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { SpaceSwitcher } from './space-switcher';
import { QuickMessages } from '@/components/messages/quick-messages';
import { findNavItem } from './nav';
import { UserMenu } from './user-menu';

const titleCase = (s: string) => s.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function useCrumbs() {
  const pathname = usePathname();
  const recent = useRecentSpaces();
  if (pathname === '/') return [{ label: 'Home', href: '/' }];
  if (pathname.startsWith('/messages')) return [{ label: 'Messages', href: '/messages' }];
  const parts = pathname.split('/').filter(Boolean);
  return parts.map((part, i) => {
    const href = '/' + parts.slice(0, i + 1).join('/');
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(part);
    // A space key (/spaces/ENG) reads better as the space's name when we know it.
    const spaceName =
      parts[i - 1] === 'spaces' ? recent.find((s) => s.key.toLowerCase() === part.toLowerCase())?.name : undefined;
    return {
      label: findNavItem(href)?.title ?? spaceName ?? (isId ? 'Details' : titleCase(part)),
      href,
    };
  });
}

export function Topbar() {
  const crumbs = useCrumbs();
  const pathname = usePathname();
  // Each page shows its own name in the browser tab, e.g. "Board · Crew Deck".
  const last = crumbs[crumbs.length - 1]?.label;
  useEffect(() => {
    if (last) document.title = `${last} · Crew Deck`;
  }, [last, pathname]);
  return (
    <header className="bg-background z-10 shrink-0 border-b px-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex h-12 w-full max-w-7xl items-center gap-1.5">
        <SidebarTrigger
          aria-label="Toggle sidebar"
          className={pathname.startsWith('/messages') ? 'md:hidden' : undefined}
        />
        <Breadcrumb className="min-w-0 flex-1">
          <BreadcrumbList className="flex-nowrap text-sm">
            {crumbs.map((c, i) => (
              <Fragment key={c.href}>
                {i > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem className="min-w-0">
                  {i === crumbs.length - 1 ? (
                    <BreadcrumbPage className="truncate">{c.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={c.href}>{c.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
        <CheckinControl />
        <SpaceSwitcher />
        <CommandPalette />
        <QuickMessages />
        <NotificationBell side="bottom" />
        {/* The theme toggle lives in the rail on desktop; the rail is hidden below md. */}
        <div className="md:hidden">
          <ThemeToggle />
        </div>
        <UserMenu side="bottom" />
      </div>
    </header>
  );
}
