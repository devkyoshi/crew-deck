'use client';

import { CalendarClock } from 'lucide-react';
import { UserAvatar } from '@/components/work/work-bits';
import { hrefOf, type AppNotification } from '@/lib/notifications-api';
import { cn } from '@/lib/utils';

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

export function NotificationRow({
  n,
  onOpen,
  compact,
}: {
  n: AppNotification;
  onOpen: (href: string) => void;
  compact?: boolean;
}) {
  const unread = !n.readAt;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(hrefOf(n))}
        className={cn('hover:bg-accent/60 flex w-full gap-3 px-3 text-left', compact ? 'py-2.5' : 'py-3', unread && 'bg-primary/5')}
      >
        {n.actor ? (
          <UserAvatar person={n.actor} size={28} />
        ) : (
          <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full">
            <CalendarClock className="size-4" aria-hidden />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className={cn('block text-sm', unread && 'font-medium')}>{n.text}</span>
          <time dateTime={n.createdAt} className="text-muted-foreground text-xs">
            {ago(n.createdAt)}
          </time>
        </span>
        {unread && (
          <span className="bg-primary mt-1.5 size-2 shrink-0 rounded-full" aria-label="Unread" role="img" />
        )}
      </button>
    </li>
  );
}
