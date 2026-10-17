'use client';

import { Suspense, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadError } from '@/components/shared/load-error';
import { ListSkeleton } from '@/components/shared/skeletons';
import { Input } from '@/components/ui/input';
import { FoundItems } from '@/components/work/found-items';
import { ItemSheet, useUrlState } from '@/components/work/item-sheet';
import { useSearch } from '@/lib/work-find-api';

function SearchResults() {
  const { params, push } = useUrlState();
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  // Apply the typed text to the address shortly after typing stops.
  useEffect(() => {
    if (draft === q) return;
    const t = setTimeout(() => push((p) => (draft.trim() ? p.set('q', draft.trim()) : p.delete('q')), true), 300);
    return () => clearTimeout(t);
  }, [draft, q, push]);
  const results = useSearch(q, { limit: 50 });

  return (
    <div className="space-y-6">
      <PageHeader title="Search" description="Find work by key or by words in the title and description." />
      <div className="relative max-w-xl">
        <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
        <Input
          autoFocus
          type="search"
          aria-label="Search work"
          placeholder="ENG-142 or words…"
          className="pl-9"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>
      {!q ? (
        <EmptyState title="Search across your spaces" description="Results only include spaces you can open." />
      ) : results.isError ? (
        <LoadError what="search results" onRetry={() => results.refetch()} />
      ) : results.isPending ? (
        <ListSkeleton rows={4} />
      ) : results.data && results.data.items.length === 0 ? (
        <EmptyState title="No results" description={`Nothing matches “${q}”.`} />
      ) : (
        <div aria-live="polite" className="space-y-2">
          <p className="text-muted-foreground text-xs">
            {results.data?.items.length}
            {results.data?.nextOffset !== null ? '+' : ''} results
          </p>
          <FoundItems items={results.data?.items ?? []} />
        </div>
      )}
      <ItemSheet />
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchResults />
    </Suspense>
  );
}
