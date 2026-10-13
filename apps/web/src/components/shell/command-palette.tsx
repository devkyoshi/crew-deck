'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Moon, Search, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useIsAdmin } from './me-context';
import { visibleGroups } from './nav';
import { useSignOut } from './user-menu';

/** Navigation-only palette (Ctrl/Cmd+K). Record search arrives with the modules that own the records. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const isAdmin = useIsAdmin();
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
        <CommandInput placeholder="Jump to…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {visibleGroups(isAdmin).map((g) => (
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
          <CommandSeparator />
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
