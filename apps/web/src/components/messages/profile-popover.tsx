'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Clock, MessageSquare, Users } from 'lucide-react';
import { CHECKIN_BADGE_LABELS, type CheckinBadge, type PersonDTO } from '@crew-deck/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/components/shell/me-context';
import { api } from '@/lib/api';
import { personName, useOpenDm, usePresence } from '@/lib/messaging-api';
import type { ProfileCardDTO } from '@crew-deck/shared';
import { cn } from '@/lib/utils';
import { PersonAvatar, PRESENCE_LABEL } from './person-avatar';
import { useMessaging } from './store';

const PILL: Record<CheckinBadge, string> = {
  onsite: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100',
  remote: 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-100',
  offsite: 'bg-violet-100 text-violet-900 dark:bg-violet-500/20 dark:text-violet-100',
  leave: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100',
};

/** Where someone works today: a word, never a time. */
export function CheckinPill({ badge, className }: { badge: CheckinBadge; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1.5 text-[10px] leading-4 font-medium',
        PILL[badge],
        className,
      )}
    >
      {CHECKIN_BADGE_LABELS[badge]}
    </span>
  );
}

/** The badge for a person, from what the presence lookups last told us. Nothing when they are not in. */
export function useCheckinOf(userId: string | null | undefined): CheckinBadge | null {
  return useMessaging((s) => (userId ? s.checkin[userId] : undefined)) ?? null;
}

/** Looks up presence and check-in for these people and keeps the shared store current. */
export function useTrackPeople(ids: string[]) {
  const q = usePresence(ids);
  useEffect(() => {
    const st = useMessaging.getState();
    for (const p of q.data ?? []) {
      if (!st.presence[p.id]) st.setPresence(p.id, p.state);
      st.setCheckin(p.id, p.checkin ?? null);
    }
  }, [q.data]);
}

/** Their local time, e.g. "3:42 PM (UTC+1)". */
function localTime(timezone: string | null) {
  if (!timezone) return null;
  try {
    return new Intl.DateTimeFormat([], {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date());
  } catch {
    return null;
  }
}

function Card({ id, onNavigate }: { id: string; onNavigate: () => void }) {
  const router = useRouter();
  const me = useMe().user;
  const openDm = useOpenDm();
  const q = useQuery({
    queryKey: ['messaging', 'profile-card', id],
    queryFn: async () => (await api<{ person: ProfileCardDTO }>(`/people/${id}/card`)).person,
    staleTime: 30_000,
    retry: false,
  });
  if (q.isLoading)
    return (
      <div className="space-y-3 p-1" role="status" aria-label="Loading profile">
        <div className="flex items-center gap-3">
          <Skeleton className="size-12 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <Skeleton className="h-8 w-full" />
      </div>
    );
  if (q.isError || !q.data) return <p className="text-sm">Could not load this person.</p>;
  const p = q.data;
  const time = localTime(p.timezone);
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <PersonAvatar person={p} size="lg" presence={false} />
        <div className="min-w-0">
          <p className="truncate text-base leading-tight font-semibold">{personName(p)}</p>
          {p.jobTitle && <p className="text-muted-foreground truncate text-sm">{p.jobTitle}</p>}
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">{PRESENCE_LABEL[p.presence]}</span>
            {p.checkin && <CheckinPill badge={p.checkin} />}
          </p>
        </div>
      </div>
      {p.status && (
        <p className="bg-muted/50 rounded-md px-2 py-1.5 text-sm">
          <span aria-hidden>{p.status.emoji}</span> {p.status.text}
        </p>
      )}
      <ul className="text-muted-foreground space-y-1 text-[13px]">
        {time && (
          <li className="flex items-center gap-2">
            <Clock className="size-3.5" aria-hidden /> {time}
          </li>
        )}
        {p.groups.length > 0 && (
          <li className="flex items-center gap-2">
            <Users className="size-3.5 shrink-0" aria-hidden /> {p.groups.join(', ')}
          </li>
        )}
        <li className="flex items-center gap-2">
          <Briefcase className="size-3.5" aria-hidden /> {p.openItems} open work item
          {p.openItems === 1 ? '' : 's'}
        </li>
      </ul>
      <div className="flex gap-2">
        {p.id !== me.id && (
          <Button
            size="sm"
            className="flex-1"
            loading={openDm.isPending}
            onClick={() =>
              openDm.mutate([p.id], {
                onSuccess: ({ channel }) => {
                  onNavigate();
                  router.push(`/messages/${channel.id}`);
                },
              })
            }
          >
            <MessageSquare /> Message
          </Button>
        )}
        <Button size="sm" variant="outline" className="flex-1" asChild>
          <Link href={`/people/${p.id}`} onClick={onNavigate}>
            View profile
          </Link>
        </Button>
      </div>
    </div>
  );
}

/** Wrap a name or avatar (a button) to open the person's card on click. */
export function ProfilePopover({
  person,
  children,
}: {
  person: Pick<PersonDTO, 'id'> | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!person) return <>{children}</>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        {open && <Card id={person.id} onNavigate={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  );
}
