'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck } from 'lucide-react';
import { Illustration } from '@/components/illustrations';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMarkRead, useNotifications, useUnreadCount } from '@/lib/notifications-api';
import { NotificationRow } from './notification-row';

export function NotificationBell({ side = 'right' }: { side?: 'right' | 'bottom' }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const count = useUnreadCount().data?.unread ?? 0;
  const list = useNotifications(false);
  const markRead = useMarkRead();
  const items = list.data?.pages[0]?.items.slice(0, 8) ?? [];
  // Rings when the unread count goes up (not on first load).
  const prev = useRef<number | null>(null);
  const [ringing, setRinging] = useState(false);
  useEffect(() => {
    if (prev.current !== null && count > prev.current) {
      setRinging(true);
      const t = setTimeout(() => setRinging(false), 1000);
      prev.current = count;
      return () => clearTimeout(t);
    }
    prev.current = count;
  }, [count]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void list.refetch();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="text-muted-foreground relative size-9 rounded-lg" aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}>
          <Bell className={cn('size-5', ringing && 'animate-bell-ring')} strokeWidth={1.5} />
          {count > 0 && (
            <span key={count} className="animate-pop bg-danger text-white absolute -top-0.5 -right-0.5 min-w-4 rounded-full px-1 text-xs leading-4 font-semibold tabular-nums">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side={side} className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <Button variant="ghost" size="sm" className="h-7" disabled={!count || markRead.isPending} onClick={() => markRead.mutate({ all: true })}>
            <CheckCheck /> Mark all read
          </Button>
        </div>
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-3 py-6 text-center">
            <Illustration name="caughtup" size="sm" />
            <p className="text-muted-foreground text-sm">You are all caught up.</p>
          </div>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {items.map((n) => (
              <NotificationRow
                key={n.id}
                n={n}
                compact
                onOpen={(href) => {
                  if (!n.readAt) markRead.mutate({ ids: [n.id] });
                  setOpen(false);
                  router.push(href);
                }}
              />
            ))}
          </ul>
        )}
        <div className="border-t px-3 py-2 text-center">
          <Link href="/notifications" onClick={() => setOpen(false)} className="text-primary text-sm hover:underline">
            See all notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
