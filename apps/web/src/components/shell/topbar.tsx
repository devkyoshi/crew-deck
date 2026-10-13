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
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { CommandPalette } from './command-palette';
import { findNavItem } from './nav';
import { UserMenu } from './user-menu';

const titleCase = (s: string) => s.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function useCrumbs() {
  const pathname = usePathname();
  if (pathname === '/') return [{ label: 'Home', href: '/' }];
  const parts = pathname.split('/').filter(Boolean);
  return parts.map((part, i) => {
    const href = '/' + parts.slice(0, i + 1).join('/');
    return { label: findNavItem(href)?.title ?? titleCase(part), href };
  });
}

export function Topbar() {
  const crumbs = useCrumbs();
  return (
    <header className="bg-background/80 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
      <SidebarTrigger aria-label="Toggle sidebar" />
      <Separator orientation="vertical" className="mr-1 h-5" />
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
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
      <CommandPalette />
      <ThemeToggle />
      <UserMenu />
    </header>
  );
}
