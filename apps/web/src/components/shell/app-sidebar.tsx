'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Check, ChevronRight, ChevronsUpDown, Layers, LayoutGrid, Plus } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { useIsAdmin, useMe } from './me-context';
import { workTypeLabel } from '@/components/workspace/work-type-picker';
import { openWorkspace } from '@/lib/workspaces';
import { useToday } from '@/components/checkin/use-today';
import { useCrmAccess } from '@/lib/crm';
import { useUnreadSummary } from '@/lib/messaging-api';
import { visibleGroups } from './nav';
import { SpacesNav } from './spaces-nav';

/** Remembers whether a sidebar group is open, per browser. */
function usePersistedOpen(key: string, initial = true) {
  const [open, setOpen] = useState(initial);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) setOpen(saved === '1');
    } catch {
      /* storage unavailable */
    }
  }, [key]);
  const update = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem(key, v ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  };
  return [open, update] as const;
}

function TenantSwitcher() {
  const { org, orgs } = useMe();

  // Opens the other workspace already signed in (no second sign-in).
  const switchTo = (slug: string) => void openWorkspace(slug);

  const label = (
    <>
      {org.logoUrl ? (
        <img src={org.logoUrl} alt="" className="size-7 shrink-0 rounded-md object-cover" />
      ) : (
        <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
          <Layers className="size-3.5" aria-hidden />
        </span>
      )}
      <span className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
        <span className="truncate text-[13px] font-semibold">{org.name}</span>
        <span className="text-muted-foreground truncate text-[11px]">{org.slug}</span>
      </span>
    </>
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              aria-label="Switch workspace"
              className="group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:size-9!"
            >
              {label}
              <ChevronsUpDown
                className="size-3.5 opacity-60 group-data-[collapsible=icon]:hidden"
                aria-hidden
              />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {orgs.map((o) => (
              <DropdownMenuItem key={o.id} onSelect={() => o.slug !== org.slug && switchTo(o.slug)}>
                <span className="grid flex-1 leading-tight">
                  <span className="truncate">{o.name}</span>
                  {o.workType && (
                    <span className="text-muted-foreground truncate text-[11px]">
                      {workTypeLabel(o.workType)}
                    </span>
                  )}
                </span>
                {o.slug === org.slug && <Check className="size-4" aria-hidden />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/my-workspaces">
                <LayoutGrid className="size-4" aria-hidden /> All workspaces
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/my-workspaces/new">
                <Plus className="size-4" aria-hidden /> Create a workspace
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function NavGroupSection({ group }: { group: ReturnType<typeof visibleGroups>[number] }) {
  const pathname = usePathname();
  const [open, setOpen] = usePersistedOpen(`sidebar:${group.id}`);
  const unread = useUnreadSummary();

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarGroup>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger>
            {group.label}
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
            {group.id === 'spaces' ? (
              <SpacesNav />
            ) : (
              <SidebarMenu>
                {group.items.map((item) => {
                  const active =
                    item.href === '/' || item.href === '/crm'
                      ? pathname === item.href
                      : pathname.startsWith(item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                        <Link href={item.href} aria-current={active ? 'page' : undefined}>
                          <item.icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                      {item.href === '/messages' && unread.dms > 0 && (
                        <SidebarMenuBadge className="bg-destructive text-destructive-foreground rounded-full">
                          {unread.dms > 99 ? '99+' : unread.dms}
                          <span className="sr-only"> unread direct messages and mentions</span>
                        </SidebarMenuBadge>
                      )}
                      {item.href === '/messages' && unread.dms === 0 && unread.channels > 0 && (
                        <SidebarMenuBadge>
                          <span className="bg-primary size-2 rounded-full" aria-hidden />
                          <span className="sr-only">Unread channels</span>
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

export function AppSidebar() {
  const isAdmin = useIsAdmin();
  const checkinOn = useToday().data?.enabled !== false;
  const crmVisible = useCrmAccess().data?.canView === true;
  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="border-sidebar-border border-b p-2">
        <TenantSwitcher />
      </SidebarHeader>
      <SidebarContent>
        {visibleGroups(isAdmin, checkinOn, crmVisible).map((g) => (
          <NavGroupSection key={g.id} group={g} />
        ))}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
