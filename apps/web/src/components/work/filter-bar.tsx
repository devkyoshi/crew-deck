'use client';

import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Calendar,
  Check,
  Flag,
  Layers,
  Package,
  Puzzle,
  ListFilter,
  Search,
  Shapes,
  Tag,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { NO_FILTERS, type Filters } from '@/lib/work-filters';
import { searchAssignees, searchItems, useLabels } from '@/lib/work-api';
import {
  PRIORITY_META,
  type ItemType,
  type Person,
  type Priority,
} from '@/lib/work';
import { cn } from '@/lib/utils';
import { useComponents, useVersions } from '@/lib/versions-api';
import { LabelChip } from './label-bits';
import { PriorityIcon, TypeIcon, UserAvatar } from './work-bits';
import { useVocabulary } from './use-vocabulary';

const DUE_LABEL: Record<Exclude<Filters['due'], ''>, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  week: 'Due this week',
  none: 'No due date',
};
const BOARD_TYPES: ItemType[] = ['story', 'task', 'bug'];
const PRIORITIES: Priority[] = ['highest', 'high', 'medium', 'low', 'lowest'];

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/** One filter control: a button with a count that opens a list of checkable options. */
function FilterPopover({
  icon: Icon,
  label,
  count,
  children,
  width = 'w-60',
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  children: ReactNode;
  width?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn('h-8', count > 0 && 'border-primary/50 bg-accent text-accent-foreground')}
          aria-label={count ? `${label}, ${count} selected` : label}
        >
          <Icon aria-hidden /> {label}
          {count > 0 && (
            <span className="bg-primary text-primary-foreground ml-0.5 rounded-full px-1.5 text-xs font-semibold tabular-nums">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn('max-h-80 overflow-y-auto p-1', width)}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

function Option({
  checked,
  onToggle,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onToggle}
      className="hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none"
    >
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-sm border',
          checked && 'bg-primary border-primary text-primary-foreground',
        )}
        aria-hidden
      >
        {checked && <Check className="size-3" />}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
    </button>
  );
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function FilterBar({
  space,
  filters,
  onChange,
  searchRef,
}: {
  space: string;
  filters: Filters;
  onChange: (next: Filters) => void;
  searchRef?: RefObject<HTMLInputElement | null>;
}) {
  const vocab = useVocabulary();
  const [text, setText] = useState(filters.q);
  const debounced = useDebounced(text, 300);
  // The box follows the URL (Back button, "Clear all") and the URL follows the box once typing settles.
  useEffect(() => setText(filters.q), [filters.q]);
  useEffect(() => {
    if (debounced.trim() !== filters.q.trim()) onChange({ ...filters, q: debounced });
  }, [debounced]);

  const [personQuery, setPersonQuery] = useState('');
  const dq = useDebounced(personQuery, 200);
  const people = useQuery({
    queryKey: ['assignees', space.toUpperCase(), dq],
    queryFn: () => searchAssignees(space, dq),
    staleTime: 30_000,
  });
  const everyone = useQuery({
    queryKey: ['assignees', space.toUpperCase(), ''],
    queryFn: () => searchAssignees(space, ''),
    staleTime: 60_000,
  });
  const labels = useLabels(space);
  const versions = useVersions(space);
  const components = useComponents(space);
  const epics = useQuery({
    queryKey: ['item-picker', space.toUpperCase(), 'epic', ''],
    queryFn: () => searchItems(space, { type: 'epic' }),
    staleTime: 30_000,
  });

  const personById = new Map<string, Person>((everyone.data ?? []).map((p) => [p.id, p]));
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const labelById = new Map((labels.data?.items ?? []).map((l) => [l.id, l]));
  const epicById = new Map((epics.data ?? []).map((e) => [e.id, e]));

  // Chips for what is switched on, each removable.
  const chips: { key: string; label: ReactNode; remove: () => void }[] = [];
  if (filters.q.trim())
    chips.push({ key: 'q', label: <>“{filters.q.trim()}”</>, remove: () => set({ q: '' }) });
  for (const a of filters.assignee)
    chips.push({
      key: `a-${a}`,
      label:
        a === 'none' ? (
          'Unassigned'
        ) : (
          <>Assignee: {personById.get(a)?.name ?? personById.get(a)?.email ?? 'someone'}</>
        ),
      remove: () => set({ assignee: filters.assignee.filter((x) => x !== a) }),
    });
  for (const t of filters.type)
    chips.push({
      key: `t-${t}`,
      label: <>Type: {vocab.typeLabel(t)}</>,
      remove: () => set({ type: filters.type.filter((x) => x !== t) }),
    });
  for (const p of filters.priority)
    chips.push({
      key: `p-${p}`,
      label: <>Priority: {PRIORITY_META[p]?.label ?? p}</>,
      remove: () => set({ priority: filters.priority.filter((x) => x !== p) }),
    });
  for (const l of filters.label)
    chips.push({
      key: `l-${l}`,
      label: <>Label: {labelById.get(l)?.name ?? 'label'}</>,
      remove: () => set({ label: filters.label.filter((x) => x !== l) }),
    });
  for (const e of filters.epic)
    chips.push({
      key: `e-${e}`,
      label: e === 'none' ? 'No epic' : <>Epic: {epicById.get(e)?.title ?? 'epic'}</>,
      remove: () => set({ epic: filters.epic.filter((x) => x !== e) }),
    });
  for (const v of filters.version)
    chips.push({
      key: `v-${v}`,
      label: v === 'none' ? 'No version' : <>Version: {versions.data?.items.find((x) => x.id === v)?.name ?? 'version'}</>,
      remove: () => set({ version: filters.version.filter((x) => x !== v) }),
    });
  for (const c of filters.component)
    chips.push({
      key: `c-${c}`,
      label: c === 'none' ? 'No component' : <>Component: {components.data?.items.find((x) => x.id === c)?.name ?? 'component'}</>,
      remove: () => set({ component: filters.component.filter((x) => x !== c) }),
    });
  if (filters.due)
    chips.push({ key: 'due', label: DUE_LABEL[filters.due], remove: () => set({ due: '' }) });
  if (filters.mine) chips.push({ key: 'mine', label: `My ${vocab.nounPlural}`, remove: () => set({ mine: false }) });
  if (filters.recent)
    chips.push({ key: 'recent', label: 'Recently updated', remove: () => set({ recent: false }) });
  if (filters.blocked) chips.push({ key: 'blocked', label: 'Blocked', remove: () => set({ blocked: false }) });

  return (
    <div className="space-y-2" role="search" aria-label="Filter the board">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-56">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" aria-hidden />
          <Input
            ref={searchRef}
            type="search"
            aria-label="Search this board"
            placeholder="Search"
            className="h-8 pr-7 pl-8"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
          />
          {!text && (
            <kbd className="bg-muted text-muted-foreground pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded-sm px-1 text-xs sm:block" aria-hidden>
              /
            </kbd>
          )}
        </div>

        <FilterPopover icon={UserRound} label="Assignee" count={filters.assignee.length}>
          <div className="p-1">
            <Input
              aria-label="Search people"
              placeholder="Search people"
              className="mb-1 h-8"
              value={personQuery}
              onChange={(e) => setPersonQuery(e.target.value)}
            />
          </div>
          {!personQuery && (
            <Option
              checked={filters.assignee.includes('none')}
              onToggle={() => set({ assignee: toggle(filters.assignee, 'none') })}
            >
              <UserAvatar person={null} size={20} /> Unassigned
            </Option>
          )}
          {(people.data ?? []).map((p) => (
            <Option
              key={p.id}
              checked={filters.assignee.includes(p.id)}
              onToggle={() => set({ assignee: toggle(filters.assignee, p.id) })}
            >
              <UserAvatar person={p} size={20} />
              <span className="truncate">{p.name ?? p.email}</span>
            </Option>
          ))}
          {people.isSuccess && people.data.length === 0 && (
            <p className="text-muted-foreground p-2 text-xs">No one found.</p>
          )}
        </FilterPopover>

        <FilterPopover icon={Shapes} label="Type" count={filters.type.length} width="w-44">
          {BOARD_TYPES.filter((t) => vocab.allowedTypes.includes(t) || filters.type.includes(t)).map((t) => (
            <Option key={t} checked={filters.type.includes(t)} onToggle={() => set({ type: toggle(filters.type, t) })}>
              <TypeIcon type={t} /> {vocab.typeLabel(t)}
            </Option>
          ))}
        </FilterPopover>

        <FilterPopover icon={Flag} label="Priority" count={filters.priority.length} width="w-44">
          {PRIORITIES.map((p) => (
            <Option key={p} checked={filters.priority.includes(p)} onToggle={() => set({ priority: toggle(filters.priority, p) })}>
              <PriorityIcon priority={p} withLabel />
            </Option>
          ))}
        </FilterPopover>

        <FilterPopover icon={Tag} label="Label" count={filters.label.length}>
          {(labels.data?.items ?? []).map((l) => (
            <Option key={l.id} checked={filters.label.includes(l.id)} onToggle={() => set({ label: toggle(filters.label, l.id) })}>
              <LabelChip label={l} />
            </Option>
          ))}
          {labels.isSuccess && labels.data.items.length === 0 && (
            <p className="text-muted-foreground p-2 text-xs">No labels in this space yet.</p>
          )}
        </FilterPopover>

        <FilterPopover icon={Layers} label="Epic" count={filters.epic.length} width="w-64">
          <Option checked={filters.epic.includes('none')} onToggle={() => set({ epic: toggle(filters.epic, 'none') })}>
            No epic
          </Option>
          {(epics.data ?? []).map((e) => (
            <Option key={e.id} checked={filters.epic.includes(e.id)} onToggle={() => set({ epic: toggle(filters.epic, e.id) })}>
              <TypeIcon type="epic" />
              <span className="truncate">{e.title}</span>
            </Option>
          ))}
        </FilterPopover>

        {(versions.data?.items.length ?? 0) > 0 && (
          <FilterPopover icon={Package} label="Version" count={filters.version.length}>
            <Option checked={filters.version.includes('none')} onToggle={() => set({ version: toggle(filters.version, 'none') })}>
              No version
            </Option>
            {versions.data!.items
              .filter((v) => v.state !== 'archived' || filters.version.includes(v.id))
              .map((v) => (
                <Option key={v.id} checked={filters.version.includes(v.id)} onToggle={() => set({ version: toggle(filters.version, v.id) })}>
                  <span className="truncate">{v.name}</span>
                </Option>
              ))}
          </FilterPopover>
        )}

        {(components.data?.items.length ?? 0) > 0 && (
          <FilterPopover icon={Puzzle} label="Component" count={filters.component.length}>
            <Option checked={filters.component.includes('none')} onToggle={() => set({ component: toggle(filters.component, 'none') })}>
              No component
            </Option>
            {components.data!.items.map((c) => (
              <Option key={c.id} checked={filters.component.includes(c.id)} onToggle={() => set({ component: toggle(filters.component, c.id) })}>
                <span className="truncate">{c.name}</span>
              </Option>
            ))}
          </FilterPopover>
        )}

        <FilterPopover icon={Calendar} label="Due" count={filters.due ? 1 : 0} width="w-44">
          {(Object.keys(DUE_LABEL) as (keyof typeof DUE_LABEL)[]).map((d) => (
            <Option key={d} checked={filters.due === d} onToggle={() => set({ due: filters.due === d ? '' : d })}>
              {DUE_LABEL[d]}
            </Option>
          ))}
        </FilterPopover>

        <span className="bg-border mx-1 hidden h-5 w-px sm:block" aria-hidden />
        <Button
          type="button"
          size="sm"
          variant={filters.mine ? 'default' : 'outline'}
          className="h-8"
          aria-pressed={filters.mine}
          onClick={() => set({ mine: !filters.mine })}
        >
          My {vocab.nounPlural}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={filters.recent ? 'default' : 'outline'}
          className="h-8"
          aria-pressed={filters.recent}
          onClick={() => set({ recent: !filters.recent })}
        >
          Recently updated
        </Button>
        <Button
          type="button"
          size="sm"
          variant={filters.blocked ? 'default' : 'outline'}
          className="h-8"
          aria-pressed={filters.blocked}
          onClick={() => set({ blocked: !filters.blocked })}
        >
          Blocked
        </Button>
      </div>

      {chips.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          <li className="text-muted-foreground flex items-center gap-1 text-xs">
            <ListFilter className="size-3.5" aria-hidden /> Showing
          </li>
          {chips.map((c) => (
            <li key={c.key}>
              <span className="bg-secondary text-secondary-foreground inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs">
                {c.label}
                <button
                  type="button"
                  onClick={c.remove}
                  className="hover:bg-foreground/10 rounded-full p-0.5 outline-none focus-visible:ring-2"
                  aria-label="Remove this filter"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            </li>
          ))}
          <li>
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onChange(NO_FILTERS)}>
              Clear all
            </Button>
          </li>
        </ul>
      )}
    </div>
  );
}
