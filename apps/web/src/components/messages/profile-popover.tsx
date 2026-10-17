'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Clock, Mail, MessageSquare, Pencil, Users } from 'lucide-react';
import { CHECKIN_BADGE_LABELS, type CheckinBadge, type PersonDTO } from '@crew-deck/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/components/shell/me-context';
import { StatusDialog } from '@/components/shell/status-dialog';
import { api } from '@/lib/api';
import { personName, useOpenDm, usePresence } from '@/lib/messaging-api';
import type { ProfileCardDTO } from '@crew-deck/shared';
import { cn } from '@/lib/utils';
import { PersonAvatar, PRESENCE_LABEL } from './person-avatar';
import { useMessaging } from './store';

const PILL: Record<CheckinBadge, string> = {
  onsite: 'bg-success-soft text-success-soft-foreground ',
  remote: 'bg-info-soft text-info-soft-foreground ',
  offsite: 'bg-violet-soft text-violet-soft-foreground ',
  leave: 'bg-warning-soft text-warning-soft-foreground ',
};

/** Where someone works today: a word, never a time. */
export function CheckinPill({ badge, className }: { badge: CheckinBadge; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-sm px-1.5 text-xs leading-4 font-medium',
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
      const status = p.status && (p.status.emoji || p.status.text) ? p.status : null;
      st.setCustomStatus(p.id, status);
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

function Card({
  id,
  onNavigate,
  onEditStatus,
}: {
  id: string;
  onNavigate: () => void;
  onEditStatus: () => void;
}) {
  const router = useRouter();
  const me = useMe().user;
  const openDm = useOpenDm();
  const q = useQuery({
    queryKey: ['messaging', 'profile-card', id],
    queryFn: async () => (await api<{ person: ProfileCardDTO }>(`/people/${id}/card`)).person,
    staleTime: 30_000,
    retry: false,
  });
  // The card does not carry when a status ends; the presence lookup does.
  const expiresAt = usePresence([id]).data?.find((x) => x.id === id)?.status?.expiresAt ?? null;
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
      {p.status && (p.status.text || p.status.emoji) && (
        <div className="bg-muted/50 flex items-start gap-2.5 rounded-md px-2.5 py-2">
          <span className="text-xl leading-none" aria-hidden>
            {p.status.emoji ?? '💬'}
          </span>
          <p className="min-w-0 text-sm">
            <span className="sr-only">Status: </span>
            {p.status.text}
            {expiresAt && (
              <span className="text-muted-foreground block text-xs">
                Until{' '}
                {new Date(expiresAt).toLocaleString([], {
                  ...(new Date(expiresAt).toDateString() !== new Date().toDateString() && {
                    weekday: 'short',
                  }),
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            )}
          </p>
        </div>
      )}
      <ul className="text-muted-foreground space-y-1.5 text-label">
        {p.email && (
          <li className="flex items-center gap-2">
            <Mail className="size-3.5 shrink-0" aria-hidden />
            <a href={`mailto:${p.email}`} className="hover:text-foreground truncate hover:underline">
              {p.email}
            </a>
          </li>
        )}
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
        {p.id === me.id ? (
          <Button size="sm" className="flex-1" onClick={onEditStatus}>
            <Pencil /> Edit status
          </Button>
        ) : (
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
  const [statusOpen, setStatusOpen] = useState(false);
  const me = useMe().user;
  if (!person) return <>{children}</>;
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent align="start" className="w-80">
          {open && (
            <Card
              id={person.id}
              onNavigate={() => setOpen(false)}
              onEditStatus={() => {
                setOpen(false);
                setStatusOpen(true);
              }}
            />
          )}
        </PopoverContent>
      </Popover>
      {person.id === me.id && <StatusDialog open={statusOpen} onOpenChange={setStatusOpen} />}
    </>
  );
}
