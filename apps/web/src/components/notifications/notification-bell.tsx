'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMarkRead, useNotifications, useUnreadCount } from '@/lib/notifications-api';
import { NotificationRow } from './notification-row';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const count = useUnreadCount().data?.unread ?? 0;
  const list = useNotifications(false);
  const markRead = useMarkRead();
  const items = list.data?.pages[0]?.items.slice(0, 8) ?? [];

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void list.refetch();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-8" aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}>
          <Bell />
          {count > 0 && (
            <span className="bg-red-600 text-white absolute -top-0.5 -right-0.5 min-w-4 rounded-full px-1 text-[10px] leading-4 font-semibold tabular-nums">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <Button variant="ghost" size="sm" className="h-7" disabled={!count || markRead.isPending} onClick={() => markRead.mutate({ all: true })}>
            <CheckCheck /> Mark all read
          </Button>
        </div>
        {items.length === 0 ? (
          <p className="text-muted-foreground px-3 py-8 text-center text-sm">You are all caught up.</p>
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
