'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Clock, Inbox, LayoutGrid, Plus, Star } from 'lucide-react';
import {
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';
import { api, qs, type AccessRequest, type Page, type Space } from '@/lib/api';
import { useRecentSpaces } from '@/lib/recent-spaces';
import { spaceIcon } from '@/lib/space-icons';

function SpaceLink({ spaceKey, name, icon }: { spaceKey: string; name: string; icon: string }) {
  const pathname = usePathname();
  const Icon = spaceIcon(icon);
  const href = `/spaces/${spaceKey}`;
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild isActive={active}>
        <Link href={href} aria-current={active ? 'page' : undefined}>
          <Icon />
          <span>{name}</span>
        </Link>
      </SidebarMenuSubButton>
      {active && (
        <ul className="border-sidebar-border mt-0.5 mb-1 ml-4 space-y-0.5 border-l pl-2 text-xs">
          {[
            { to: href, label: 'Overview' },
            { to: `${href}/board`, label: 'Board' },
          ].map((l) => {
            const on = l.to === href ? pathname === href : pathname.startsWith(l.to) || pathname.startsWith(`${href}/items`) && l.label === 'Board';
            return (
              <li key={l.to}>
                <Link
                  href={l.to}
                  aria-current={on ? 'page' : undefined}
                  className={`hover:bg-sidebar-accent block rounded px-2 py-1 ${on ? 'text-sidebar-accent-foreground font-medium' : 'text-sidebar-foreground/80'}`}
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </SidebarMenuSubItem>
  );
}

/** Sidebar content for the Spaces group: All spaces, then Starred and Recent as nested items. */
export function SpacesNav() {
  const pathname = usePathname();
  const recent = useRecentSpaces();
  const starred = useQuery({
    queryKey: ['spaces', { starred: true, sidebar: true }],
    queryFn: () =>
      api<Page<Space>>(`/spaces${qs({ starred: 'true', status: 'all', pageSize: 5 })}`),
    staleTime: 30_000,
  });
  const pending = useQuery({
    queryKey: ['access-requests', { mine: false, status: 'pending', badge: true }],
    queryFn: () =>
      api<Page<AccessRequest>>(`/access-requests${qs({ status: 'pending', pageSize: 1 })}`),
    refetchInterval: 60_000,
  });
  const pendingCount = pending.data?.total ?? 0;
  const requestsActive = pathname === '/access-requests' || pathname === '/request-access';
  const starredItems = starred.data?.items ?? [];
  const starredKeys = new Set(starredItems.map((s) => s.key));
  const recentItems = recent.filter((r) => !starredKeys.has(r.key)).slice(0, 3);
  const allActive = pathname === '/spaces' || pathname === '/spaces/new';

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild isActive={allActive} tooltip="All spaces">
            <Link href="/spaces" aria-current={allActive ? 'page' : undefined}>
              <LayoutGrid />
              <span>All spaces</span>
            </Link>
          </SidebarMenuButton>
          <SidebarMenuAction asChild showOnHover>
            <Link href="/spaces/new" aria-label="Create space">
              <Plus />
            </Link>
          </SidebarMenuAction>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild isActive={requestsActive} tooltip="Access requests">
            <Link href="/access-requests" aria-current={requestsActive ? 'page' : undefined}>
              <Inbox />
              <span>Access requests</span>
            </Link>
          </SidebarMenuButton>
          {pendingCount > 0 && (
            <SidebarMenuBadge
              aria-label={`${pendingCount} pending`}
              className="bg-primary text-primary-foreground rounded-full text-[10px]"
            >
              {pendingCount}
            </SidebarMenuBadge>
          )}
        </SidebarMenuItem>
      </SidebarMenu>

      <div className="group-data-[collapsible=icon]:hidden">
        {starredItems.length > 0 && (
          <>
            <SidebarGroupLabel className="mt-1.5 h-6 gap-1.5">
              <Star className="size-3" aria-hidden /> Starred
            </SidebarGroupLabel>
            <SidebarMenuSub className="mx-2 mt-0">
              {starredItems.map((s) => (
                <SpaceLink key={s.id} spaceKey={s.key} name={s.name} icon={s.icon} />
              ))}
            </SidebarMenuSub>
          </>
        )}
        {recentItems.length > 0 && (
          <>
            <SidebarGroupLabel className="mt-1.5 h-6 gap-1.5">
              <Clock className="size-3" aria-hidden /> Recent
            </SidebarGroupLabel>
            <SidebarMenuSub className="mx-2 mt-0">
              {recentItems.map((s) => (
                <SpaceLink key={s.key} spaceKey={s.key} name={s.name} icon={s.icon} />
              ))}
            </SidebarMenuSub>
          </>
        )}
        {starredItems.length === 0 && recentItems.length === 0 && (
          <p className="text-muted-foreground px-2 pt-2 text-xs">
            Star a space or open one and it will show up here.
          </p>
        )}
      </div>
    </>
  );
}
