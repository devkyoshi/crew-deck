'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="text-muted-foreground size-11 rounded-xl"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <Sun className="size-[22px] dark:hidden" strokeWidth={1.5} />
      <Moon className="hidden size-[22px] dark:block" strokeWidth={1.5} />
    </Button>
  );
}
