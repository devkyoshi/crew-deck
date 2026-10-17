'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { RealtimeProvider } from '@/components/messages/realtime';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import type { Me } from '@/lib/api';
import { AppRail } from './rail';
import { AppSidebar } from './app-sidebar';
import { MeProvider } from './me-context';
import { Branding, StatusBanners } from './status-banners';
import { Topbar } from './topbar';

export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  // Messages fills the screen below the top bar instead of sitting in the padded page column.
  const fullBleed = usePathname().startsWith('/messages');
  return (
    <MeProvider me={me}>
      <RealtimeProvider>
      <SidebarProvider className="bg-page h-svh min-h-0 p-0 md:p-3">
        <a
          href="#main"
          className="bg-background sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        <Branding />
        <div className="bg-background flex min-w-0 flex-1 overflow-hidden md:rounded-xl md:border">
        <AppRail />
        <AppSidebar />
        <SidebarInset>
          <Topbar />
          <StatusBanners />
          <main id="main" className={fullBleed ? 'min-h-0 flex-1 overflow-hidden' : 'min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:px-10 lg:pt-2 lg:pb-10'}>
            {fullBleed ? children : <div className="mx-auto w-full max-w-7xl">{children}</div>}
          </main>
        </SidebarInset>
      </SidebarProvider>
      </RealtimeProvider>
    </MeProvider>
  );
}
