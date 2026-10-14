'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Moon, Search, SearchCheck, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useIsAdmin } from './me-context';
import { useToday } from '@/components/checkin/use-today';
import { useCrmAccess } from '@/lib/crm';
import { visibleGroups } from './nav';
import { useSignOut } from './user-menu';
import { TypeIcon, StatusChip } from '@/components/work/work-bits';
import { useSearch } from '@/lib/work-find-api';

/** Ctrl/Cmd+K: jump to work items by key or words, to pages, and run a few actions. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const found = useSearch(dq, { limit: 8, enabled: open });
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const checkinOn = useToday().data?.enabled !== false;
  const crmVisible = useCrmAccess().data?.canView === true;
  const { resolvedTheme, setTheme } = useTheme();
  const signOut = useSignOut();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-muted-foreground w-9 justify-start px-2.5 lg:w-56"
        onClick={() => setOpen(true)}
        aria-label="Search and jump to"
      >
        <Search className="size-4 shrink-0" />
        <span className="hidden flex-1 text-left lg:inline">Search…</span>
        <kbd className="bg-muted hidden rounded px-1.5 font-mono text-[10px] lg:inline">Ctrl K</kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Jump to"
        description="Search for a page or action"
      >
        <CommandInput placeholder="Search work or jump to…" value={q} onValueChange={setQ} />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {dq && (found.data?.items.length ?? 0) > 0 && (
            <CommandGroup heading="Work">
              {found.data!.items.map((i) => (
                <CommandItem
                  key={i.id}
                  // cmdk filters by its own matching; the server already did, so keep every result.
                  value={`${q} ${i.key} ${i.title}`}
                  onSelect={() => run(() => router.push(`/spaces/${i.spaceKey}/items/${i.key}`))}
                >
                  <TypeIcon type={i.type} />
                  <span className="text-muted-foreground w-20 shrink-0 tabular-nums">{i.key}</span>
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  <StatusChip name={i.status.name} category={i.status.category} className="hidden sm:inline-flex" />
                </CommandItem>
              ))}
              <CommandItem value={`${q} search all results`} onSelect={() => run(() => router.push(`/search?q=${encodeURIComponent(dq)}`))}>
                <SearchCheck /> See all results for “{dq}”
              </CommandItem>
            </CommandGroup>
          )}
          {visibleGroups(isAdmin, checkinOn, crmVisible).map((g) => (
            <CommandGroup key={g.id} heading={g.label}>
              {g.items.map((item) => (
                <CommandItem
                  key={item.href}
                  value={`${g.label} ${item.title}`}
                  onSelect={() => run(() => router.push(item.href))}
                >
                  <item.icon />
                  {item.title}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          <CommandGroup heading="Actions">
            <CommandItem
              onSelect={() => run(() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'))}
            >
              {resolvedTheme === 'dark' ? <Sun /> : <Moon />}
              Toggle theme
            </CommandItem>
            <CommandItem onSelect={() => run(signOut)}>
              <LogOut />
              Sign out
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
