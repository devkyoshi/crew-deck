'use client';

import type { ReactNode } from 'react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import type { Me } from '@/lib/api';
import { AppSidebar } from './app-sidebar';
import { MeProvider } from './me-context';
import { Topbar } from './topbar';

export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  return (
    <MeProvider me={me}>
      <SidebarProvider>
        <a
          href="#main"
          className="bg-background sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        <AppSidebar />
        <SidebarInset>
          <Topbar />
          <main id="main" className="flex-1 p-4 sm:p-8">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </MeProvider>
  );
}
