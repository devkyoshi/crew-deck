'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Check, ChevronRight, ChevronsUpDown, Layers } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { useIsAdmin, useMe } from './me-context';
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
  const multiple = orgs.length > 1;

  function switchTo(slug: string) {
    const { protocol, host } = window.location;
    window.location.assign(`${protocol}//${slug}.${host.split('.').slice(1).join('.')}/`);
  }

  const label = (
    <>
      <span className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
        <Layers className="size-4" aria-hidden />
      </span>
      <span className="grid flex-1 text-left leading-tight">
        <span className="truncate font-semibold">{org.name}</span>
        <span className="text-muted-foreground truncate text-xs">{org.slug}</span>
      </span>
    </>
  );

  if (!multiple) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" className="cursor-default hover:bg-transparent">
            {label}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" aria-label="Switch workspace">
              {label}
              <ChevronsUpDown className="size-4 opacity-60" aria-hidden />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {orgs.map((o) => (
              <DropdownMenuItem key={o.id} onSelect={() => o.slug !== org.slug && switchTo(o.slug)}>
                <span className="flex-1">{o.name}</span>
                {o.slug === org.slug && <Check className="size-4" aria-hidden />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function NavGroupSection({ group }: { group: ReturnType<typeof visibleGroups>[number] }) {
  const pathname = usePathname();
  const [open, setOpen] = usePersistedOpen(`sidebar:${group.id}`);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarGroup>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger>
            {group.label}
            <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
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
                    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.title}
                        className="relative h-9 rounded-xl data-[active=true]:font-medium data-[active=true]:before:absolute data-[active=true]:before:-left-2 data-[active=true]:before:top-2 data-[active=true]:before:h-5 data-[active=true]:before:w-[3px] data-[active=true]:before:rounded-full data-[active=true]:before:bg-primary"
                      >
                        <Link href={item.href} aria-current={active ? 'page' : undefined}>
                          <item.icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
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
  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <TenantSwitcher />
      </SidebarHeader>
      <SidebarContent>
        {visibleGroups(isAdmin).map((g) => (
          <NavGroupSection key={g.id} group={g} />
        ))}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
