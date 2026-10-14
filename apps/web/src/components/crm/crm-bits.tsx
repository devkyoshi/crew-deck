'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Lock, Plus, PowerOff, Tag as TagIcon, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useHydrated } from '@/components/checkin/use-hydrated';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorView } from '@/components/shared/error-view';
import { TONES } from '@/components/shared/pastel';
import { api, ApiError, qs, type Member, type Page } from '@/lib/api';
import { useCrmAccess, type Company, type Tag } from '@/lib/crm';
import { cn } from '@/lib/utils';

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Wraps every CRM screen: loading, module switched off, and no access are handled in one place. */
export function CrmGate({
  children,
  need = 'view',
}: {
  children: ReactNode;
  need?: 'view' | 'edit' | 'admin';
}) {
  const access = useCrmAccess();
  // The sidebar asks for CRM access too and hydrates first; until this page has hydrated, render what
  // the server rendered, or an early answer causes a hydration mismatch.
  const hydrated = useHydrated();
  if (!hydrated || access.isPending)
    return <Skeleton role="status" aria-label="Loading" className="h-64 w-full rounded-2xl" />;
  if (access.isError) return <ErrorView error={access.error} reset={() => access.refetch()} />;
  const a = access.data;
  if (!a.enabled) {
    return (
      <EmptyState
        icon={PowerOff}
        title="The CRM is switched off"
        description="A workspace admin can turn it back on in Administration → CRM."
      />
    );
  }
  const allowed = need === 'view' ? a.canView : need === 'edit' ? a.canEdit : a.canAdmin;
  if (!allowed) {
    return (
      <EmptyState
        icon={Lock}
        title="You don’t have access to this"
        description="Ask a workspace admin to give you CRM access from your profile."
      />
    );
  }
  return <>{children}</>;
}

export function TagChip({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  const tone = TONES[tag.color as keyof typeof TONES] ?? TONES.blue;
  return (
    <Badge
      variant="outline"
      className={cn('gap-1 rounded-full border-transparent px-2.5 font-normal', tone.pill)}
    >
      {tag.name}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove tag ${tag.name}`}
          className="-mr-1 rounded-full p-0.5 hover:bg-black/10"
        >
          <X className="size-3" aria-hidden />
        </button>
      )}
    </Badge>
  );
}

export function TagList({ tags }: { tags: Tag[] }) {
  if (!tags.length) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <TagChip key={t.id} tag={t} />
      ))}
    </span>
  );
}

const NONE = '__none';

/** Pick one active member, or nobody. */
export function OwnerSelect({
  value,
  onChange,
  id,
  allowNone = true,
  label = 'Owner',
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  id?: string;
  allowNone?: boolean;
  label?: string;
}) {
  const members = useQuery({
    queryKey: ['members', 'pick-owner'],
    queryFn: () => api<Page<Member>>(`/members${qs({ status: 'active', pageSize: 100 })}`),
    staleTime: 60_000,
  });
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id} aria-label={label} className="w-full">
        <SelectValue placeholder={members.isPending ? 'Loading…' : 'Unassigned'} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>Unassigned</SelectItem>}
        {members.data?.items.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name ?? m.email}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Search-as-you-type picker for one company. */
export function CompanyPicker({
  value,
  label,
  onChange,
  id,
}: {
  value: string | null | undefined;
  label?: string | null;
  onChange: (c: { id: string; name: string } | null) => void;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const results = useQuery({
    queryKey: ['crm-companies', 'pick', dq],
    queryFn: () => api<Page<Company>>(`/crm/companies${qs({ q: dq, pageSize: 20 })}`),
    enabled: open,
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Company"
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {value ? (label ?? 'Selected company') : 'No company'}
          </span>
          <ChevronsUpDown className="size-4 opacity-60" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder="Search companies" />
          <CommandList>
            <CommandEmpty>{results.isPending ? 'Searching…' : 'No companies found.'}</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <X className="size-4" aria-hidden /> Clear company
                </CommandItem>
              )}
              {results.data?.items.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.id}
                  onSelect={() => {
                    onChange({ id: c.id, name: c.name });
                    setOpen(false);
                  }}
                >
                  <span className="flex-1 truncate">{c.name}</span>
                  {c.id === value && <Check className="size-4" aria-hidden />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Choose tags for a record, and create a new tag on the spot. */
export function TagPicker({ value, onChange }: { value: Tag[]; onChange: (t: Tag[]) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const access = useCrmAccess();
  const tags = useQuery({
    queryKey: ['crm-tags'],
    queryFn: () => api<{ items: Tag[] }>('/crm/tags'),
    enabled: open,
  });
  const has = (id: string) => value.some((t) => t.id === id);

  async function create() {
    setError(null);
    try {
      const tag = await api<Tag>('/crm/tags', { method: 'POST', body: { name: name.trim() } });
      await qc.invalidateQueries({ queryKey: ['crm-tags'] });
      onChange([...value, tag]);
      setName('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the tag');
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((t) => (
        <TagChip key={t.id} tag={t} onRemove={() => onChange(value.filter((x) => x.id !== t.id))} />
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-full px-2.5 text-xs"
          >
            <TagIcon className="size-3" aria-hidden /> Add tag
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-2 p-3" align="start">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Available tags">
            {tags.isPending && (
              <Skeleton role="status" aria-label="Loading tags" className="h-6 w-24" />
            )}
            {tags.data?.items.length === 0 && (
              <p className="text-muted-foreground text-xs">No tags yet.</p>
            )}
            {tags.data?.items.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={has(t.id)}
                onClick={() =>
                  onChange(has(t.id) ? value.filter((x) => x.id !== t.id) : [...value, t])
                }
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs',
                  has(t.id) ? 'bg-accent text-accent-foreground border-primary' : 'hover:bg-muted',
                )}
              >
                {t.name}
              </button>
            ))}
          </div>
          {access.data?.canEdit && (
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) void create();
              }}
            >
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="New tag"
                aria-label="New tag name"
                className="h-8"
                maxLength={40}
              />
              <Button type="submit" size="sm" className="h-8" aria-label="Create tag">
                <Plus className="size-4" aria-hidden />
              </Button>
            </form>
          )}
          {error && <p className="text-destructive text-xs">{error}</p>}
        </PopoverContent>
      </Popover>
    </div>
  );
}
