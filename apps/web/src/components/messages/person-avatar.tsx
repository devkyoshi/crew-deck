'use client';

import type { PersonDTO, PresenceState } from '@crew-deck/shared';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { initials } from '@/components/shell/me-context';
import { cn } from '@/lib/utils';
import { useMessaging } from './store';

const DOT: Record<PresenceState, string> = {
  online: 'bg-emerald-500',
  away: 'bg-amber-400',
  dnd: 'bg-red-500',
  offline: 'bg-muted-foreground/50',
};
export const PRESENCE_LABEL: Record<PresenceState, string> = {
  online: 'Online',
  away: 'Away',
  dnd: 'Do not disturb',
  offline: 'Offline',
};

/** A quiet colour per person, so a busy channel is easier to scan than a wall of grey circles. */
const TINTS = [
  'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200',
  'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100',
  'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
  'bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-200',
];
const tintOf = (id: string) =>
  TINTS[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length]!;

export function PresenceDot({ state, className }: { state: PresenceState; className?: string }) {
  return (
    <span
      role="img"
      aria-label={PRESENCE_LABEL[state]}
      className={cn('ring-background block size-2.5 rounded-full ring-2', DOT[state], className)}
    />
  );
}

export function usePresenceOf(userId: string | null | undefined): PresenceState {
  return useMessaging((s) => (userId ? s.presence[userId] : undefined)) ?? 'offline';
}

type Person = Pick<PersonDTO, 'id' | 'name' | 'email' | 'avatarUrl'>;

/** Avatar with a presence dot. `size` follows the shared Avatar sizes. */
export function PersonAvatar({
  person,
  size = 'default',
  presence = true,
  className,
}: {
  person: Person | null;
  size?: 'default' | 'sm' | 'lg';
  presence?: boolean;
  className?: string;
}) {
  const state = usePresenceOf(person?.id);
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <Avatar size={size}>
        {person?.avatarUrl && <AvatarImage src={person.avatarUrl} alt="" />}
        <AvatarFallback className={cn('text-[11px] font-medium', person && tintOf(person.id))}>
          {person ? initials(person.name, person.email) : '?'}
        </AvatarFallback>
      </Avatar>
      {presence && person && (
        <PresenceDot state={state} className="absolute -right-0.5 -bottom-0.5" />
      )}
    </span>
  );
}
