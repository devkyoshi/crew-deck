'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment } from 'react';
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
import { findNavItem } from './nav';
import { UserMenu } from './user-menu';

const titleCase = (s: string) => s.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function useCrumbs() {
  const pathname = usePathname();
  if (pathname === '/') return [{ label: 'Home', href: '/' }];
  if (pathname.startsWith('/messages')) return [{ label: 'Messages', href: '/messages' }];
  const parts = pathname.split('/').filter(Boolean);
  return parts.map((part, i) => {
    const href = '/' + parts.slice(0, i + 1).join('/');
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(part);
    return { label: findNavItem(href)?.title ?? (isId ? 'Details' : titleCase(part)), href };
  });
}

export function Topbar() {
  const crumbs = useCrumbs();
  return (
    <header className="bg-background z-10 shrink-0 border-b px-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex h-12 w-full max-w-7xl items-center gap-1.5">
        <SidebarTrigger aria-label="Toggle sidebar" />
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
        <NotificationBell side="bottom" />
        {/* Theme and account live in the rail on desktop; the rail is hidden below md. */}
        <div className="flex items-center gap-1 md:hidden">
          <ThemeToggle />
          <UserMenu side="bottom" />
        </div>
      </div>
    </header>
  );
}
