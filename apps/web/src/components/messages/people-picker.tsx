'use client';

import { useId, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { usePeople } from '@/lib/messaging-api';
import type { Member } from '@/lib/api';
import { useMe } from '@/components/shell/me-context';
import { cn } from '@/lib/utils';
import { PersonAvatar } from './person-avatar';

const asPerson = (m: Pick<Member, 'id' | 'name' | 'email' | 'avatarUrl'>) => ({
  id: m.id,
  name: m.name,
  email: m.email,
  avatarUrl: m.avatarUrl,
});

/**
 * Pick people from the workspace: search, tick, and the chosen ones stay visible as chips. Used for
 * new messages, new channels and adding people to a channel.
 */
export function PeoplePicker({
  value,
  onChange,
  max,
  exclude = [],
  includeSelf = false,
  autoFocus,
}: {
  value: Member[];
  onChange: (v: Member[]) => void;
  max?: number;
  exclude?: string[];
  includeSelf?: boolean;
  autoFocus?: boolean;
}) {
  const me = useMe().user.id;
  const [search, setSearch] = useState('');
  const people = usePeople(search.trim());
  const id = useId();
  const selected = new Set(value.map((v) => v.id));
  const items = (people.data ?? []).filter(
    (m) => !exclude.includes(m.id) && (includeSelf || m.id !== me),
  );
  const full = max !== undefined && value.length >= max;

  const toggle = (m: Member) =>
    onChange(
      selected.has(m.id) ? value.filter((v) => v.id !== m.id) : full ? value : [...value, m],
    );

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected people">
          {value.map((m) => (
            <li
              key={m.id}
              className="bg-secondary flex items-center gap-1.5 rounded-full py-0.5 pr-1 pl-0.5 text-[13px]"
            >
              <PersonAvatar person={asPerson(m)} size="sm" presence={false} />
              <span className="max-w-32 truncate">{m.name ?? m.email}</span>
              <button
                type="button"
                aria-label={`Remove ${m.name ?? m.email}`}
                onClick={() => toggle(m)}
                className="hover:bg-background focus-visible:ring-ring/50 rounded-full p-0.5 outline-none focus-visible:ring-2"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          autoFocus={autoFocus}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email"
          aria-label="Search people"
          aria-controls={id}
          className="pl-8"
        />
      </div>
      <ul
        id={id}
        className="max-h-64 divide-y overflow-y-auto rounded-md border"
        aria-label="People"
      >
        {people.isLoading && (
          <li className="text-muted-foreground px-3 py-6 text-center text-sm">Loading people…</li>
        )}
        {people.isError && (
          <li className="text-destructive px-3 py-6 text-center text-sm">
            Could not load people. Try again.
          </li>
        )}
        {!people.isLoading && !people.isError && items.length === 0 && (
          <li className="text-muted-foreground px-3 py-6 text-center text-sm">
            {search ? 'Nobody matches that search.' : 'No one else is here yet.'}
          </li>
        )}
        {items.map((m) => {
          const on = selected.has(m.id);
          const disabled = !on && full;
          return (
            <li key={m.id}>
              <label
                className={cn(
                  'hover:bg-muted/60 flex cursor-pointer items-center gap-3 px-3 py-2',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <Checkbox
                  checked={on}
                  disabled={disabled}
                  onCheckedChange={() => toggle(m)}
                  aria-label={m.name ?? m.email}
                />
                <PersonAvatar person={asPerson(m)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{m.name ?? m.email}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {m.jobTitle ?? m.email}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {max !== undefined && (
        <p className="text-muted-foreground text-xs">
          {value.length} of {max} selected
        </p>
      )}
    </div>
  );
}
