'use client';

import { use, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, LayoutGrid } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import type { SpaceFeature } from '@crew-deck/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { SpaceProvider } from '@/components/spaces/space-context';
import { DockedChat, DockedChatButton, useDockedChat } from '@/components/spaces/docked-chat';
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
import { useLiveSpace } from '@/lib/live';

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
  const chat = useDockedChat();

  const query = useQuery({
    queryKey: ['space', key],
    queryFn: () => api<SpaceDetail>(`/spaces/${key}`),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  });

  const space = query.data;
  // Live updates for everything in this space (board, list, backlog, open items).
  const live = useLiveSpace(space?.key);
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
      <div className="space-y-4" role="status" aria-busy="true" aria-label="Loading space">
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
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/spaces">Back to spaces</Link>
            </Button>
            {missing && (
              <Button asChild>
                <Link href={`/request-access?key=${encodeURIComponent(key.toUpperCase())}`}>
                  Request access
                </Link>
              </Button>
            )}
          </div>
        }
      />
    );
  }

  const base = `/spaces/${space.key}`;
  // Chat sits beside the board and the backlog, where people look at work while they talk about it.
  const chatHere = pathname.startsWith(`${base}/board`) || pathname.startsWith(`${base}/backlog`);
  const has = (f: SpaceFeature) => space.features.includes(f);
  const tabs = [
    { href: base, label: 'Overview' },
    ...(has('tickets') ? [{ href: `${base}/tickets`, label: 'Tickets' }] : []),
    ...(has('sprints') ? [{ href: `${base}/backlog`, label: 'Backlog' }] : []),
    { href: `${base}/board`, label: 'Board' },
    { href: `${base}/list`, label: 'List' },
    ...(has('epics') ? [{ href: `${base}/epics`, label: 'Epics' }] : []),
    ...(has('roadmap') ? [{ href: `${base}/roadmap`, label: 'Roadmap' }] : []),
    ...(has('calendar') ? [{ href: `${base}/calendar`, label: 'Calendar' }] : []),
    ...(has('releases') ? [{ href: `${base}/releases`, label: 'Releases' }] : []),
    { href: `${base}/documents`, label: 'Documents' },
    { href: `${base}/reports`, label: 'Reports' },
    { href: `${base}/members`, label: 'Members' },
    ...(space.permissions.edit ? [{ href: `${base}/settings`, label: 'Settings' }] : []),
  ];

  return (
    <SpaceProvider value={space}>
      <div className={cn('space-y-6', chatHere && chat.open && 'xl:mr-[400px]')}>
        <header className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <SpaceIcon icon={space.icon} spaceKey={space.key} className="size-12 rounded-lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-display truncate">{space.name}</h1>
                <KeyChip spaceKey={space.key} />
                <VisibilityPill visibility={space.visibility} />
                {space.status === 'archived' && <ArchivedPill />}
              </div>
              {space.description && (
                <p className="text-muted-foreground mt-1 text-sm">{space.description}</p>
              )}
            </div>
            {live === 'reconnecting' && (
              <span className="text-muted-foreground text-xs" role="status">
                Reconnecting…
              </span>
            )}
            {chatHere && (
              <DockedChatButton
                spaceKey={space.key}
                open={chat.open}
                onToggle={() => chat.setOpen(!chat.open)}
              />
            )}
            <StarButton id={space.id} starred={space.starred} name={space.name} />
          </div>

          {space.status === 'archived' && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warning-soft p-3 text-sm text-warning-soft-foreground ">
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
            <ul className="-mb-px flex gap-6 overflow-x-auto">
              {tabs.map((t) => {
                const active = t.href === base ? pathname === base : pathname.startsWith(t.href);
                return (
                  <li key={t.href}>
                    <Link
                      href={t.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'text-muted-foreground hover:text-foreground relative inline-block py-2.5 text-label font-medium whitespace-nowrap transition-colors duration-150',
                        active && 'text-foreground',
                      )}
                    >
                      {t.label}
                      {active && (
                        <motion.span
                          layoutId="space-tab-underline"
                          className="bg-foreground absolute inset-x-0 bottom-0 h-0.5 rounded-full"
                          transition={{ type: 'spring', stiffness: 500, damping: 42 }}
                        />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </header>

        {children}
      </div>
      {chatHere && chat.open && (
        <DockedChat
          spaceKey={space.key}
          spaceName={space.name}
          onClose={() => chat.setOpen(false)}
        />
      )}
    </SpaceProvider>
  );
}
