'use client';

import { useEffect, useRef, useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * The emoji picker: search, categories, recents and skin tones (emoji-mart). It is loaded only when
 * first opened, so the emoji data (a few hundred KB) never weighs on the initial page.
 */
function Picker({ onPick, dark }: { onPick: (emoji: string) => void; dark: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    let picker: HTMLElement | null = null;
    let cancelled = false;
    void Promise.all([import('emoji-mart'), import('@emoji-mart/data')]).then(([mart, data]) => {
      if (cancelled || !host.current) return;
      picker = new mart.Picker({
        data: data.default,
        theme: dark ? 'dark' : 'light',
        onEmojiSelect: (e: { native: string }) => pick.current(e.native),
        previewPosition: 'none',
        skinTonePosition: 'search',
        navPosition: 'top',
        maxFrequentRows: 2,
        perLine: 8,
        autoFocus: true,
        // Lets the popover own the scrolling, and keeps focus handling predictable inside it.
        dynamicWidth: false,
      }) as unknown as HTMLElement;
      host.current.replaceChildren(picker);
    });
    return () => {
      cancelled = true;
      picker?.remove();
    };
  }, [dark]);
  return (
    <div ref={host} className="min-h-[435px] min-w-[352px]">
      <p className="text-muted-foreground p-4 text-sm">Loading emoji…</p>
    </div>
  );
}

/** A button that opens the picker in a popover and reports the chosen emoji. */
export function EmojiPickerButton({
  onPick,
  label = 'Add reaction',
  className,
  size = 'icon-xs',
  side = 'top',
}: {
  onPick: (emoji: string) => void;
  label?: string;
  className?: string;
  size?: 'icon-xs' | 'icon-sm';
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const dark = useTheme().resolvedTheme === 'dark';
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size={size} aria-label={label} className={className}>
              <SmilePlus />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side={side}
        align="end"
        className="w-auto border-0 bg-transparent p-0 shadow-none"
        collisionPadding={12}
      >
        <Picker
          dark={dark}
          onPick={(e) => {
            setOpen(false);
            onPick(e);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
