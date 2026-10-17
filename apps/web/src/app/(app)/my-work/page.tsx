'use client';

import { Suspense, useMemo } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadError } from '@/components/shared/load-error';
import { ListSkeleton } from '@/components/shared/skeletons';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FoundItems } from '@/components/work/found-items';
import { ItemSheet, useUrlState } from '@/components/work/item-sheet';
import { useVocabulary } from '@/components/work/use-vocabulary';
import { useMyItems, type FoundItem } from '@/lib/work-find-api';

const ROLES = ['assigned', 'reported', 'watching'] as const;
const STATES = ['open', 'done', 'all'] as const;

function MyWork() {
  const vocab = useVocabulary();
  const { params, push } = useUrlState();
  const role = (ROLES as readonly string[]).includes(params.get('role') ?? '') ? (params.get('role') as (typeof ROLES)[number]) : 'assigned';
  const state = (STATES as readonly string[]).includes(params.get('state') ?? '') ? (params.get('state') as (typeof STATES)[number]) : 'open';
  const items = useMyItems(role, state);
  const groups = useMemo(() => {
    const out = new Map<string, FoundItem[]>();
    for (const i of items.data?.items ?? []) out.set(i.spaceName ?? i.spaceKey, [...(out.get(i.spaceName ?? i.spaceKey) ?? []), i]);
    return [...out.entries()];
  }, [items.data]);

  return (
    <div className="space-y-6">
      <PageHeader title="My work" description={`Your ${vocab.nounPlural} across every space you can open.`} />
      <div className="flex flex-wrap gap-3">
        <Tabs value={role} onValueChange={(v) => push((p) => p.set('role', v), true)}>
          <TabsList aria-label="Whose work">
            <TabsTrigger value="assigned">Assigned to me</TabsTrigger>
            <TabsTrigger value="reported">Reported by me</TabsTrigger>
            <TabsTrigger value="watching">Watching</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={state} onValueChange={(v) => push((p) => p.set('state', v), true)}>
          <TabsList aria-label="Which items">
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="done">Done</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {items.isError ? (
        <LoadError what="your work" onRetry={() => items.refetch()} />
      ) : !items.data ? (
        <ListSkeleton rows={5} />
      ) : groups.length === 0 ? (
        <EmptyState title="Nothing here" description={role === 'assigned' && state === 'open' ? 'You are all caught up.' : `No ${vocab.nounPlural} match.`} />
      ) : (
        groups.map(([name, list]) => (
          <section key={name} aria-label={name} className="space-y-2">
            <h2 className="text-sm font-semibold">
              {name} <span className="text-muted-foreground font-normal">{list.length}</span>
            </h2>
            <FoundItems items={list} showSpace={false} />
          </section>
        ))
      )}
      <ItemSheet />
    </div>
  );
}

export default function MyWorkPage() {
  return (
    <Suspense>
      <MyWork />
    </Suspense>
  );
}
