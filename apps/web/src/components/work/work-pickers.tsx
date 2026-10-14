'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { searchAssignees, searchItems } from '@/lib/work-api';
import {
  CATEGORY_META,
  PRIORITY_META,
  TYPE_META,
  type ItemType,
  type Person,
  type Priority,
  type WorkItem,
  type WorkStatus,
} from '@/lib/work';
import { cn } from '@/lib/utils';
import { PriorityIcon, StatusChip, TypeIcon, UserAvatar } from './work-bits';

function useDebounced<T>(value: T, ms = 200) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const triggerClass = 'w-full justify-between font-normal';

export function AssigneePicker({
  space,
  value,
  onChange,
  disabled,
  id,
}: {
  space: string;
  value: Person | null;
  onChange: (p: Person | null) => void;
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const people = useQuery({
    queryKey: ['assignees', space.toUpperCase(), dq],
    queryFn: () => searchAssignees(space, dq),
    enabled: open,
    staleTime: 15_000,
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={triggerClass}
        >
          <span className="flex min-w-0 items-center gap-2">
            <UserAvatar person={value} size={20} />
            <span className={cn('truncate', !value && 'text-muted-foreground')}>
              {value ? (value.name ?? value.email) : 'Unassigned'}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search people" value={q} onValueChange={setQ} />
          <CommandList>
            {people.isPending && <p className="text-muted-foreground p-3 text-xs">Loading…</p>}
            {people.isSuccess && people.data.length === 0 && <CommandEmpty>No one found.</CommandEmpty>}
            <CommandGroup>
              {!q && (
                <CommandItem
                  value="unassigned"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <UserAvatar person={null} size={20} /> Unassigned
                  {!value && <Check className="ml-auto size-4" aria-hidden />}
                </CommandItem>
              )}
              {people.data?.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.id}
                  onSelect={() => {
                    onChange(p);
                    setOpen(false);
                  }}
                >
                  <UserAvatar person={p} size={20} />
                  <span className="truncate">{p.name ?? p.email}</span>
                  {value?.id === p.id && <Check className="ml-auto size-4" aria-hidden />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Searchable single pick of an item in the space (an epic, or a parent for a subtask). */
export function ItemPicker({
  space,
  types,
  value,
  onChange,
  disabled,
  placeholder = 'None',
  excludeId,
  id,
}: {
  space: string;
  types: ItemType[];
  value: { id: string; key: string; title: string; type: ItemType } | null;
  onChange: (item: { id: string; key: string; title: string; type: ItemType } | null) => void;
  disabled?: boolean;
  placeholder?: string;
  excludeId?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const results = useQuery({
    queryKey: ['item-picker', space.toUpperCase(), types.join(','), dq],
    queryFn: async () => {
      const lists = await Promise.all(
        types.map((t) => searchItems(space, { type: t, ...(dq ? { q: dq } : {}) })),
      );
      return lists.flat().filter((i) => i.id !== excludeId);
    },
    enabled: open,
    staleTime: 10_000,
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={triggerClass}
        >
          <span className="flex min-w-0 items-center gap-2">
            {value && <TypeIcon type={value.type} />}
            <span className={cn('truncate', !value && 'text-muted-foreground')}>
              {value ? value.title : placeholder}
            </span>
          </span>
          {value && !disabled ? (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  e.preventDefault();
                  onChange(null);
                }
              }}
              className="hover:bg-accent rounded p-0.5"
            >
              <X className="size-3.5" aria-hidden />
            </span>
          ) : (
            <ChevronsUpDown className="size-3.5 opacity-50" aria-hidden />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search by title" value={q} onValueChange={setQ} />
          <CommandList>
            {results.isPending && <p className="text-muted-foreground p-3 text-xs">Loading…</p>}
            {results.isSuccess && results.data.length === 0 && <CommandEmpty>Nothing found.</CommandEmpty>}
            <CommandGroup>
              {results.data?.map((i: WorkItem) => (
                <CommandItem
                  key={i.id}
                  value={i.id}
                  onSelect={() => {
                    onChange({ id: i.id, key: i.key, title: i.title, type: i.type });
                    setOpen(false);
                  }}
                >
                  <TypeIcon type={i.type} />
                  <span className="text-muted-foreground text-xs tabular-nums">{i.key}</span>
                  <span className="truncate">{i.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function StatusSelect({
  statuses,
  value,
  onChange,
  disabled,
  id,
}: {
  statuses: Pick<WorkStatus, 'id' | 'name' | 'category' | 'color'>[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} size="sm" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {statuses.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            <StatusChip name={s.name} category={s.category} color={s.color} className="bg-transparent p-0" />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PrioritySelect({
  value,
  onChange,
  disabled,
  id,
}: {
  value: Priority;
  onChange: (p: Priority) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Priority)} disabled={disabled}>
      <SelectTrigger id={id} size="sm" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(PRIORITY_META) as Priority[]).map((p) => (
          <SelectItem key={p} value={p}>
            <PriorityIcon priority={p} withLabel />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TypeSelect({
  value,
  onChange,
  disabled,
  types = ['epic', 'story', 'task', 'bug', 'subtask'],
  id,
}: {
  value: ItemType;
  onChange: (t: ItemType) => void;
  disabled?: boolean;
  types?: ItemType[];
  id?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ItemType)} disabled={disabled}>
      <SelectTrigger id={id} size="sm" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {types.map((t) => (
          <SelectItem key={t} value={t}>
            <span className="flex items-center gap-2">
              <TypeIcon type={t} /> {TYPE_META[t].label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export const STORY_POINTS = [1, 2, 3, 5, 8, 13];
export { CATEGORY_META };
