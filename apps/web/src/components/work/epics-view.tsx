'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, KanbanSquare, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadError } from '@/components/shared/load-error';
import { useSpace } from '@/components/spaces/space-context';
import { toastError, useCreateItem, useSubtasks } from '@/lib/work-api';
import { useEpics, type EpicRow } from '@/lib/work-find-api';
import { cn } from '@/lib/utils';
import { ItemSheet, useOpenItem } from './item-sheet';
import { useVocabulary } from './use-vocabulary';
import { StatusChip, TypeIcon, UserAvatar } from './work-bits';

/** The space's epics with how far along each one is, by count and by points. */
export function EpicsView() {
  const space = useSpace();
  const vocab = useVocabulary();
  const epics = useEpics(space.key);
  const create = useCreateItem(space.key);
  const [title, setTitle] = useState('');
  const epicLabel = vocab.typeLabel('epic');

  if (epics.isError) return <LoadError what={`the ${epicLabel.toLowerCase()}s`} onRetry={() => epics.refetch()} />;
  if (!epics.data) return <p className="text-muted-foreground text-sm">Loading…</p>;
  const list = epics.data.items;

  return (
    <div className="space-y-4">
      {epics.data.permissions.create && (
        <form
          className="flex max-w-xl gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const t = title.trim();
            if (!t) return;
            create.mutate(
              { type: 'epic', title: t },
              {
                onSuccess: (made) => {
                  setTitle('');
                  toast.success(`${made.key} created`);
                },
                onError: (err) => toastError(err, 'Could not create it'),
              },
            );
          }}
        >
          <Input
            aria-label={`New ${epicLabel.toLowerCase()} title`}
            placeholder={`New ${epicLabel.toLowerCase()}…`}
            value={title}
            maxLength={255}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Button type="submit" disabled={!title.trim() || create.isPending}>
            <Plus /> Create
          </Button>
        </form>
      )}
      {list.length === 0 ? (
        <EmptyState
          title={`No ${epicLabel.toLowerCase()}s yet`}
          description={`${epicLabel}s group larger pieces of work. Create one above, then put ${vocab.nounPlural} under it.`}
        />
      ) : (
        <ul className="space-y-2">
          {list.map((e) => (
            <EpicRowView key={e.id} epic={e} spaceKey={space.key} />
          ))}
        </ul>
      )}
      <ItemSheet />
    </div>
  );
}

function EpicRowView({ epic, spaceKey }: { epic: EpicRow; spaceKey: string }) {
  const vocab = useVocabulary();
  const [open, setOpen] = useState(false);
  const openItem = useOpenItem();
  const kids = useSubtasks(epic.key, open);
  const { total, done, points, donePoints } = epic.progress;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <li className="bg-card rounded-lg border">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-expanded={open}
          aria-label={open ? `Hide the ${vocab.nounPlural} in ${epic.key}` : `Show the ${vocab.nounPlural} in ${epic.key}`}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <ChevronDown /> : <ChevronRight />}
        </Button>
        <TypeIcon type="epic" />
        <span className="text-muted-foreground text-sm tabular-nums">{epic.key}</span>
        <button type="button" onClick={() => openItem(epic.key)} className="min-w-0 flex-1 truncate text-left font-medium hover:underline">
          {epic.title}
        </button>
        <StatusChip name={epic.status.name} category={epic.status.category} color={epic.status.color} />
        <div className="flex w-56 items-center gap-2">
          <Progress value={pct} className="h-1.5 flex-1" aria-label={`${done} of ${total} done`} />
          <span className="text-muted-foreground text-xs tabular-nums whitespace-nowrap">
            {done}/{total}
            {points > 0 && ` · ${donePoints}/${points} pts`}
          </span>
        </div>
        <Button variant="ghost" size="sm" className="h-7" asChild>
          <Link href={`/spaces/${spaceKey}/board?epic=${epic.id}`}>
            <KanbanSquare /> Board
          </Link>
        </Button>
      </div>
      {open && (
        <div className="border-t px-3 py-2">
          {kids.isPending && <p className="text-muted-foreground text-sm">Loading…</p>}
          {kids.data && kids.data.items.length === 0 && (
            <p className="text-muted-foreground text-sm">Nothing in this {vocab.typeLabel('epic').toLowerCase()} yet.</p>
          )}
          <ul className="divide-y">
            {kids.data?.items.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-1.5">
                <TypeIcon type={c.type} />
                <span className="text-muted-foreground w-20 text-xs tabular-nums">{c.key}</span>
                <button
                  type="button"
                  onClick={() => openItem(c.key)}
                  className={cn('min-w-0 flex-1 truncate text-left text-sm hover:underline', c.status.category === 'done' && 'text-muted-foreground line-through')}
                >
                  {c.title}
                </button>
                <StatusChip name={c.status.name} category={c.status.category} className="hidden sm:inline-flex" />
                <UserAvatar person={c.assignee} size={20} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
