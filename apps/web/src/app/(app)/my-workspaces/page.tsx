'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Check, Plus } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkTypeBadge } from '@/components/workspace/work-type-picker';
import { api } from '@/lib/api';
import { openWorkspace } from '@/lib/workspaces';

interface MyWorkspace {
  id: string;
  name: string;
  slug: string;
  orgRole: string;
  workType: string | null;
  current: boolean;
  url: string;
}

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

/** Every workspace this person belongs to, and a way to start another one. */
export default function MyWorkspacesPage() {
  const q = useQuery({
    queryKey: ['my-workspaces'],
    queryFn: () => api<{ items: MyWorkspace[]; canCreate: boolean }>('/workspaces'),
  });

  return (
    <>
      <PageHeader
        title="Your workspaces"
        description="You can belong to several companies. Each has its own people, spaces and settings."
        action={
          q.data?.canCreate !== false && (
            <Button asChild>
              <Link href="/my-workspaces/new">
                <Plus /> Create a workspace
              </Link>
            </Button>
          )
        }
      />
      {q.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Workspaces">
          {q.data?.items.map((w) => (
            <li key={w.id}>
              <Card className="gap-3 p-4 shadow-none" data-testid={`workspace-${w.slug}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{w.name}</div>
                    <div className="text-muted-foreground truncate text-xs">{w.slug}</div>
                  </div>
                  {w.current ? (
                    <span className="bg-primary/10 text-primary inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
                      <Check className="size-3" aria-hidden /> Current
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => void openWorkspace(w.slug)}>
                      Open <ArrowUpRight />
                    </Button>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <WorkTypeBadge type={w.workType} />
                  <span className="text-muted-foreground text-xs">{ROLE_LABEL[w.orgRole] ?? w.orgRole}</span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
