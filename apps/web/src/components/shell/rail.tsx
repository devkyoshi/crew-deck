'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { Layers } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUnreadSummary } from '@/lib/messaging-api';
import { cn } from '@/lib/utils';
import { useCrmAccess } from '@/lib/crm';
import { useIsAdmin, useMe } from './me-context';
import { MODULES, moduleForPath } from './nav';
import { UserMenu } from './user-menu';

/** The narrow module rail: jump between Home, Messages, Spaces, CRM and Administration. */
export function AppRail() {
  const pathname = usePathname();
  const isAdmin = useIsAdmin();
  const crmVisible = useCrmAccess().data?.canView === true;
  const unread = useUnreadSummary();
  const { org } = useMe();
  const active = moduleForPath(pathname);
  const modules = MODULES.filter(
    (m) => (m.id !== 'admin' || isAdmin) && (m.id !== 'crm' || crmVisible),
  );

  return (
    <aside
      aria-label="Modules"
      className="bg-rail border-sidebar-border hidden w-16 shrink-0 flex-col items-center border-r py-5 md:flex"
    >
      <Link
        href="/"
        aria-label="Home"
        className="flex size-9 items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        {org.logoUrl ? (
          <img src={org.logoUrl} alt="" className="size-9 rounded-lg object-cover" />
        ) : (
          <span className="bg-foreground text-background flex size-9 items-center justify-center rounded-lg">
            <Layers className="size-[18px]" strokeWidth={1.5} aria-hidden />
          </span>
        )}
      </Link>

      <div className="mt-auto flex flex-col items-center gap-5">
      <nav aria-label="Modules" className="flex flex-col items-center gap-2">
        {modules.map((m) => {
          const on = active === m.id;
          const badge = m.id === 'messages' ? unread.dms : 0;
          const dot = m.id === 'messages' && unread.dms === 0 && unread.channels > 0;
          return (
            <Tooltip key={m.id}>
              <TooltipTrigger asChild>
                <Link
                  href={m.href}
                  aria-label={m.label}
                  aria-current={on ? 'page' : undefined}
                  className={cn(
                    'text-muted-foreground relative flex size-10 items-center justify-center rounded-lg outline-none transition-colors duration-150',
                    'hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                    on && 'text-primary-foreground',
                  )}
                >
                  {on && (
                    <motion.span
                      layoutId="rail-active"
                      className="bg-primary absolute inset-0 rounded-lg"
                      transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                    />
                  )}
                  <m.icon className="relative size-5" strokeWidth={1.5} aria-hidden />
                  {badge > 0 && (
                    <span className="bg-danger ring-sidebar absolute -top-0.5 -right-0.5 min-w-4 rounded-full px-1 text-center text-xs leading-4 font-semibold text-white ring-2 tnum">
                      {badge > 99 ? '99+' : badge}
                      <span className="sr-only"> unread direct messages and mentions</span>
                    </span>
                  )}
                  {dot && (
                    <span className="bg-primary ring-sidebar absolute top-1.5 right-1.5 size-2 rounded-full ring-2">
                      <span className="sr-only">Unread channels</span>
                    </span>
                  )}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{m.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      <div className="flex flex-col items-center gap-2">
        <ThemeToggle />
        <UserMenu />
      </div>
      </div>
    </aside>
  );
}
