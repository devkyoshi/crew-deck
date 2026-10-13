'use client';

import { use, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Archive, LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { SpaceProvider } from '@/components/spaces/space-context';
import {
  ArchivedPill,
  KeyChip,
  SpaceIcon,
  StarButton,
  VisibilityPill,
} from '@/components/spaces/space-bits';
import { api, ApiError, type SpaceDetail } from '@/lib/api';
import { forgetRecentSpace, pushRecentSpace } from '@/lib/recent-spaces';
import { cn } from '@/lib/utils';

export default function SpaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ key: string }>;
}) {
  const { key } = use(params);
  const pathname = usePathname();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['space', key],
    queryFn: () => api<SpaceDetail>(`/spaces/${key}`),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  });

  const space = query.data;
  useEffect(() => {
    if (space) pushRecentSpace({ key: space.key, name: space.name, icon: space.icon });
  }, [space]);
  const missing = query.error instanceof ApiError && query.error.status === 404;
  useEffect(() => {
    if (missing) forgetRecentSpace(key.toUpperCase());
  }, [missing, key]);

  const restore = useMutation({
    mutationFn: () => api<SpaceDetail>(`/spaces/${key}/restore`, { method: 'POST', body: {} }),
    onSuccess: () => {
      toast.success('Space restored');
      qc.invalidateQueries({ queryKey: ['space'] });
      qc.invalidateQueries({ queryKey: ['spaces'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not restore'),
  });

  if (query.isPending) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading space">
        <Skeleton className="h-14 w-72" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (query.isError || !space) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title={missing ? 'Space not found' : 'Could not load this space'}
        description={
          missing
            ? 'It may not exist, may have been deleted, or you may not have access to it.'
            : 'Something went wrong.'
        }
        action={
          <Button variant="outline" asChild>
            <Link href="/spaces">Back to spaces</Link>
          </Button>
        }
      />
    );
  }

  const base = `/spaces/${space.key}`;
  const tabs = [
    { href: base, label: 'Overview' },
    { href: `${base}/members`, label: 'Members' },
    ...(space.permissions.edit ? [{ href: `${base}/settings`, label: 'Settings' }] : []),
  ];

  return (
    <SpaceProvider value={space}>
      <div className="space-y-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/spaces">
            <ArrowLeft /> Spaces
          </Link>
        </Button>

        <header className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <SpaceIcon icon={space.icon} spaceKey={space.key} className="size-12 rounded-2xl" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-tight">{space.name}</h1>
                <KeyChip spaceKey={space.key} />
                <VisibilityPill visibility={space.visibility} />
                {space.status === 'archived' && <ArchivedPill />}
              </div>
              {space.description && (
                <p className="text-muted-foreground mt-1 text-sm">{space.description}</p>
              )}
            </div>
            <StarButton id={space.id} starred={space.starred} name={space.name} />
          </div>

          {space.status === 'archived' && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              <span className="flex items-center gap-2">
                <Archive className="size-4" aria-hidden /> This space is archived and read-only.
              </span>
              {space.permissions.edit && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate()}
                >
                  Restore
                </Button>
              )}
            </div>
          )}

          <nav aria-label="Space sections" className="border-b">
            <ul className="-mb-px flex gap-1">
              {tabs.map((t) => {
                const active = t.href === base ? pathname === base : pathname.startsWith(t.href);
                return (
                  <li key={t.href}>
                    <Link
                      href={t.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'text-muted-foreground hover:text-foreground inline-block border-b-2 border-transparent px-3 py-2 text-sm font-medium',
                        active && 'border-primary text-foreground',
                      )}
                    >
                      {t.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </header>

        {children}
      </div>
    </SpaceProvider>
  );
}
