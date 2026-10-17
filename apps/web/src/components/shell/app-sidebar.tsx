'use client';


import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Check, ChevronsUpDown, Layers, LayoutGrid, Plus, Search, UserPlus } from 'lucide-react';
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
  useSidebar,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { useIsAdmin, useMe } from './me-context';
import { workTypeLabel } from '@/components/workspace/work-type-picker';
import { openWorkspace } from '@/lib/workspaces';
import { useToday } from '@/components/checkin/use-today';
import { useCrmAccess } from '@/lib/crm';
import { useUnreadSummary } from '@/lib/messaging-api';
import { Kbd } from '@/components/shared/kbd';
import { moduleForPath, MODULES, visibleGroups } from './nav';
import { OPEN_PALETTE_EVENT } from './command-palette';
import { SpacesNav } from './spaces-nav';

function TenantSwitcher() {
  const { org, orgs } = useMe();
  const isAdmin = useIsAdmin();

  // Opens the other workspace already signed in (no second sign-in).
  const switchTo = (slug: string) => void openWorkspace(slug);

  const label = (
    <>
      {org.logoUrl ? (
        <img src={org.logoUrl} alt="" className="size-9 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="bg-foreground text-background flex size-9 shrink-0 items-center justify-center rounded-lg">
          <Layers className="size-[18px]" strokeWidth={1.5} aria-hidden />
        </span>
      )}
      <span className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
        <span className="truncate text-sm font-semibold">{org.name}</span>
        <span className="text-muted-foreground truncate text-xs">{org.slug}</span>
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
                    <span className="text-muted-foreground truncate text-xs">
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
            {isAdmin && (
              <DropdownMenuItem asChild>
                <Link href="/admin/members?invite=1">
                  <UserPlus className="size-4" aria-hidden /> Invite people
                </Link>
              </DropdownMenuItem>
            )}
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
  const unread = useUnreadSummary();

  if (group.id === 'spaces') {
    return (
      <SidebarGroup>
        <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SpacesNav />
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  // Items sit under their section heading, in the order the sections first appear.
  const sections = new Map<string, typeof group.items>();
  for (const item of group.items) {
    const key = item.section ?? group.label;
    sections.set(key, [...(sections.get(key) ?? []), item]);
  }

  return (
    <>
      {[...sections].map(([label, items]) => (
        <SidebarGroup key={label}>
          <SidebarGroupLabel>{label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active =
                  item.href === '/' || item.href === '/crm'
                    ? pathname === item.href
                    : pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                      <Link href={item.href} aria-current={active ? 'page' : undefined}>
                        <item.icon strokeWidth={1.5} />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                    {item.href === '/messages' && unread.dms > 0 && (
                      <SidebarMenuBadge className="bg-destructive rounded-full text-white">
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
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}

/** The search field. The palette itself is mounted once in the top bar and opened by an event. */
function SearchField() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))}
      className="bg-background text-muted-foreground hover:border-foreground/25 flex h-9 w-full items-center gap-2 rounded-lg border px-3 text-sm transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
    >
      <Search className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
      <span className="flex-1 text-left">Search</span>
      <Kbd>Ctrl K</Kbd>
    </button>
  );
}

/** The contextual panel: workspace switcher, search, and the nav group of the active rail module. */
export function AppSidebar() {
  const pathname = usePathname();
  const { isMobile, open } = useSidebar();
  const isAdmin = useIsAdmin();
  const checkinOn = useToday().data?.enabled !== false;
  const crmVisible = useCrmAccess().data?.canView === true;
  const moduleId = moduleForPath(pathname);
  const groupId = MODULES.find((m) => m.id === moduleId)!.group;
  const shown = visibleGroups(isAdmin, checkinOn, crmVisible).filter((g) => g.id === groupId);

  const body = (
    <>
      <SidebarHeader className="gap-3 border-b p-3">
        <TenantSwitcher />
      </SidebarHeader>
      <div className="px-3 pt-3">
        <SearchField />
      </div>
      <SidebarContent className="pt-2">
        {shown.map((g) => (
          <NavGroupSection key={g.id} group={g} />
        ))}
      </SidebarContent>
    </>
  );

  if (isMobile) return <Sidebar collapsible="offcanvas">{body}</Sidebar>;
  return (
    <aside
      data-slot="sidebar"
      data-state={open ? 'expanded' : 'collapsed'}
      className={cn(
        'bg-sidebar text-sidebar-foreground border-sidebar-border shrink-0 overflow-hidden border-r transition-[width] duration-200 ease-out-quint',
        open ? 'w-64' : 'w-0 border-r-0',
      )}
    >
      <div className="flex h-full w-64 flex-col">{body}</div>
    </aside>
  );
}
