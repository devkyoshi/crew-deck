'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
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
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export interface MultiPickerProps<T extends { id: string }> {
  value: T[];
  onChange: (next: T[]) => void;
  /** Server-side search; called with the debounced text. */
  search: (q: string) => Promise<T[]>;
  /** Cache key for the search, so different pickers do not share results. */
  queryKey: string;
  /** Row content inside the dropdown and the selected chips. */
  renderItem: (item: T) => ReactNode;
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  /** Items that cannot be unselected (for example the creator of a space). */
  lockedIds?: string[];
  label: string;
  id?: string;
}

/**
 * A searchable multi-select: results come from the server (so it never loads a whole workspace),
 * and chosen items stay visible as removable chips under the trigger.
 */
export function MultiPicker<T extends { id: string }>({
  value,
  onChange,
  search,
  queryKey,
  renderItem,
  placeholder,
  searchPlaceholder,
  emptyText,
  lockedIds = [],
  label,
  id,
}: MultiPickerProps<T>) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const q = useDebounced(text.trim());
  const results = useQuery({
    queryKey: ['picker', queryKey, q],
    queryFn: () => search(q),
    enabled: open,
    placeholderData: keepPreviousData,
  });
  const selected = new Set(value.map((v) => v.id));

  const toggle = (item: T) => {
    if (lockedIds.includes(item.id)) return;
    onChange(selected.has(item.id) ? value.filter((v) => v.id !== item.id) : [...value, item]);
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={label}
            className="w-full justify-between font-normal"
          >
            <span className={cn(value.length === 0 && 'text-muted-foreground')}>
              {value.length === 0 ? placeholder : `${value.length} selected`}
            </span>
            <ChevronsUpDown className="size-4 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder={searchPlaceholder} value={text} onValueChange={setText} />
            <CommandList>
              {results.isPending && (
                <div className="space-y-2 p-3" aria-busy="true">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              )}
              {results.isError && (
                <div className="text-destructive p-3 text-sm">Could not load results.</div>
              )}
              {results.data && results.data.length === 0 && (
                <CommandEmpty>{emptyText}</CommandEmpty>
              )}
              {results.data && results.data.length > 0 && (
                <CommandGroup>
                  {results.data.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      onSelect={() => toggle(item)}
                      disabled={lockedIds.includes(item.id)}
                    >
                      <span className="min-w-0 flex-1">{renderItem(item)}</span>
                      {selected.has(item.id) && <Check className="size-4" aria-hidden />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Selected: ${label}`}>
          {value.map((item) => {
            const locked = lockedIds.includes(item.id);
            return (
              <li
                key={item.id}
                className="bg-secondary flex items-center gap-1.5 rounded-full py-1 pr-1.5 pl-2.5 text-xs"
              >
                {renderItem(item)}
                {!locked && (
                  <button
                    type="button"
                    onClick={() => toggle(item)}
                    className="hover:bg-background rounded-full p-0.5"
                    aria-label="Remove"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
