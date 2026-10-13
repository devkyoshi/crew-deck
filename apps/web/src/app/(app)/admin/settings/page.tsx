'use client';

import Link from 'next/link';
import { ArrowRight, Palette, ShieldAlert, Timer } from 'lucide-react';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/admin/settings/work" className="group focus-visible:outline-none">
          <Card className="hover:border-primary/40 group-focus-visible:ring-ring/50 flex-row items-center gap-3 p-4 shadow-none transition-colors group-focus-visible:ring-[3px]">
            <IconTile tone="blue" icon={Timer} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">Work and check-in</div>
              <div className="text-muted-foreground text-xs">
                Working hours, sites, holidays and automatic check-out
              </div>
            </div>
            <ArrowRight className="text-muted-foreground size-4" aria-hidden />
          </Card>
        </Link>
        <Card className="flex-row items-center gap-3 border-dashed p-4 shadow-none">
          <IconTile tone="violet" icon={Palette} />
          <div className="min-w-0 flex-1">
            <div className="font-medium">Branding</div>
            <div className="text-muted-foreground text-xs">
              Name, logo and accent colour. Coming with workspace onboarding.
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
