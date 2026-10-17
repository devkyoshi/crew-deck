'use client';

import type { PersonDTO, PresenceState } from '@crew-deck/shared';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { initials } from '@/components/shell/me-context';
import { cn } from '@/lib/utils';
import { useMessaging } from './store';

const DOT: Record<PresenceState, string> = {
  online: 'bg-success',
  away: 'bg-warning',
  dnd: 'bg-danger',
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
  'bg-info-soft text-info-soft-foreground ',
  'bg-success-soft text-success-soft-foreground ',
  'bg-violet-soft text-violet-soft-foreground ',
  'bg-warning-soft text-warning-soft-foreground ',
  'bg-danger-soft text-danger-soft-foreground ',
  'bg-success-soft text-success-soft-foreground ',
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
        <AvatarFallback className={cn('text-xs font-medium', person && tintOf(person.id))}>
          {person ? initials(person.name, person.email) : '?'}
        </AvatarFallback>
      </Avatar>
      {presence && person && (
        <PresenceDot state={state} className="absolute -right-0.5 -bottom-0.5" />
      )}
    </span>
  );
}
