'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, LayoutGrid, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api, qs, type Page, type Space } from '@/lib/api';
import { useRecentSpaces } from '@/lib/recent-spaces';
import { spaceIcon } from '@/lib/space-icons';

/** Top-bar space switcher: recent spaces first, then a server-side search. */
export function SpaceSwitcher() {
  const router = useRouter();
  const recent = useRecentSpaces();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const results = useQuery({
    queryKey: ['spaces', { switcher: q }],
    queryFn: () => api<Page<Space>>(`/spaces${qs({ q, pageSize: 8 })}`),
    enabled: open && q.length > 0,
    placeholderData: keepPreviousData,
  });

  const go = (href: string) => {
    setOpen(false);
    setText('');
    router.push(href);
  };

  const items =
    q.length > 0
      ? (results.data?.items ?? []).map((s) => ({ key: s.key, name: s.name, icon: s.icon }))
      : recent;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="hidden md:inline-flex"
          aria-label="Switch space"
        >
          <LayoutGrid /> Spaces <ChevronsUpDown className="size-3.5 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Find a space" value={text} onValueChange={setText} />
          <CommandList>
            {q.length > 0 && !results.isPending && items.length === 0 && (
              <CommandEmpty>No spaces found.</CommandEmpty>
            )}
            {items.length > 0 && (
              <CommandGroup heading={q.length > 0 ? 'Results' : 'Recent'}>
                {items.map((s) => {
                  const Icon = spaceIcon(s.icon);
                  return (
                    <CommandItem key={s.key} value={s.key} onSelect={() => go(`/spaces/${s.key}`)}>
                      <Icon />
                      <span className="flex-1 truncate">{s.name}</span>
                      <span className="text-muted-foreground font-mono text-xs">{s.key}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            <CommandSeparator />
            <CommandGroup>
              <CommandItem value="all" onSelect={() => go('/spaces')}>
                <LayoutGrid /> All spaces
              </CommandItem>
              <CommandItem value="new" onSelect={() => go('/spaces/new')}>
                <Plus /> Create space
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
