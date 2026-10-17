'use client';

import Link from 'next/link';
import { ArrowRight, Briefcase, MessageSquare, Palette, ShieldAlert, Timer } from 'lucide-react';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { Stagger, StaggerItem } from '@/components/shared/motion';
import { IconTile } from '@/components/shared/pastel';
import { useIsAdmin } from '@/components/shell/me-context';
import { Card } from '@/components/ui/card';

export default function SettingsIndexPage() {
  const isAdmin = useIsAdmin();
  if (!isAdmin) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Admins only"
        description="You need to be a workspace admin to change settings."
      />
    );
  }
  return (
    <>
      <PageHeader title="Settings" description="Workspace-wide settings." />
      <Stagger className="grid gap-4 sm:grid-cols-2">
        <StaggerItem><Link href="/admin/settings/work" className="group block focus-visible:outline-none">
            <Card className="hover:border-primary/40 hover:-translate-y-0.5 hover:shadow-sm group-focus-visible:ring-ring/50 flex-row items-center gap-3 p-4 shadow-none transition-[color,border-color,transform,box-shadow] duration-200 group-focus-visible:ring-[3px]">
              <IconTile tone="blue" icon={Timer} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">Work and check-in</div>
                <div className="text-muted-foreground text-xs">
                  Working hours, sites, holidays and automatic check-out
                </div>
              </div>
              <ArrowRight className="text-muted-foreground size-4 transition-transform duration-200 group-hover:translate-x-1" aria-hidden />
            </Card>
          </Link></StaggerItem>
        <StaggerItem><Link href="/admin/settings/workspace" className="group block focus-visible:outline-none">
            <Card className="hover:border-primary/40 hover:-translate-y-0.5 hover:shadow-sm group-focus-visible:ring-ring/50 flex-row items-center gap-3 p-4 shadow-none transition-[color,border-color,transform,box-shadow] duration-200 group-focus-visible:ring-[3px]">
              <IconTile tone="green" icon={Briefcase} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">Kind of work</div>
                <div className="text-muted-foreground text-xs">
                  What the workspace is for, and the modules and columns that fit
                </div>
              </div>
              <ArrowRight className="text-muted-foreground size-4 transition-transform duration-200 group-hover:translate-x-1" aria-hidden />
            </Card>
          </Link></StaggerItem>
        <StaggerItem><Link href="/admin/settings/messaging" className="group block focus-visible:outline-none">
            <Card className="hover:border-primary/40 hover:-translate-y-0.5 hover:shadow-sm group-focus-visible:ring-ring/50 flex-row items-center gap-3 p-4 shadow-none transition-[color,border-color,transform,box-shadow] duration-200 group-focus-visible:ring-[3px]">
              <IconTile tone="amber" icon={MessageSquare} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">Messaging</div>
                <div className="text-muted-foreground text-xs">
                  Who can create channels, how long messages are kept, and exports
                </div>
              </div>
              <ArrowRight className="text-muted-foreground size-4 transition-transform duration-200 group-hover:translate-x-1" aria-hidden />
            </Card>
          </Link></StaggerItem>
        <StaggerItem><Link href="/admin/settings/branding" className="group block focus-visible:outline-none">
            <Card className="hover:border-primary/40 hover:-translate-y-0.5 hover:shadow-sm group-focus-visible:ring-ring/50 flex-row items-center gap-3 p-4 shadow-none transition-[color,border-color,transform,box-shadow] duration-200 group-focus-visible:ring-[3px]">
              <IconTile tone="violet" icon={Palette} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">Branding and access</div>
                <div className="text-muted-foreground text-xs">
                  Name, logo, accent colour and who can be invited
                </div>
              </div>
              <ArrowRight className="text-muted-foreground size-4 transition-transform duration-200 group-hover:translate-x-1" aria-hidden />
            </Card>
          </Link></StaggerItem>
      </Stagger>
    </>
  );
}
