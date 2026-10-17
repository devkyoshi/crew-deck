'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, LogOut, Pencil, Smile, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import type { PresenceState } from '@crew-deck/shared';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PresenceDot, usePresenceOf } from '@/components/messages/person-avatar';
import { useTrackPeople } from '@/components/messages/profile-popover';
import { useMessaging } from '@/components/messages/store';
import { RoleBadge } from '@/components/shared/badges';
import { api } from '@/lib/api';
import { usePresence, usePresenceMode, useStatusMutations } from '@/lib/messaging-api';
import { initials, useMe } from './me-context';
import { StatusDialog } from './status-dialog';

export function useSignOut() {
  const router = useRouter();
  return async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
    } catch {
      toast.error('Could not sign out. Try again.');
      return;
    }
    router.replace('/sign-in');
    router.refresh();
  };
}

const untilTomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return Math.max(1, Math.round((d.getTime() - Date.now()) / 60_000));
};

const CHOICES: { mode: 'auto' | 'away'; state: PresenceState; label: string }[] = [
  { mode: 'auto', state: 'online', label: 'Available' },
  { mode: 'away', state: 'away', label: 'Away' },
];

/** The status part of the profile menu: the custom status line, availability and do not disturb. */
function StatusSection({ onSetStatus }: { onSetStatus: () => void }) {
  const { user } = useMe();
  useTrackPeople([user.id]);
  const state = usePresenceOf(user.id);
  const mine = usePresence([user.id]).data?.find((p) => p.id === user.id);
  const custom = mine?.status && (mine.status.text || mine.status.emoji) ? mine.status : null;
  const setMode = usePresenceMode();
  const { status } = useStatusMutations();

  const apply = (v: { mode: 'auto' | 'away' | 'dnd'; minutes?: number }, done: string) =>
    setMode.mutate(v, {
      onSuccess: (r) => {
        useMessaging.getState().setPresence(user.id, r.state);
        toast.success(done);
      },
      onError: () => toast.error('Could not change that'),
    });

  return (
    <>
      <DropdownMenuItem onSelect={onSetStatus} className="items-start">
        <span className="mt-0.5 shrink-0" aria-hidden>
          {custom?.emoji ? <span className="text-base leading-none">{custom.emoji}</span> : <Smile />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{custom?.text ?? 'Set a status'}</span>
          {custom && <span className="text-muted-foreground block text-xs">Click to change</span>}
        </span>
        <Pencil className="size-3.5 opacity-60" aria-hidden />
      </DropdownMenuItem>
      {custom && (
        <DropdownMenuItem
          onSelect={() =>
            status.mutate(
              { emoji: null, text: null },
              { onSuccess: () => toast.success('Status cleared') },
            )
          }
        >
          Clear status
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-muted-foreground text-xs font-medium">
        Availability
      </DropdownMenuLabel>
      {CHOICES.map((c) => (
        <DropdownMenuItem
          key={c.mode}
          onSelect={() => apply({ mode: c.mode }, `You are ${c.label.toLowerCase()}`)}
        >
          <PresenceDot state={c.state} className="ring-0" />
          <span className="flex-1">{c.label}</span>
          {(c.mode === 'auto' ? state === 'online' : state === 'away') && <Check className="size-4" />}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <PresenceDot state="dnd" className="ring-0" />
          <span className="flex-1">Do not disturb</span>
          {state === 'dnd' && <Check className="size-4" />}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem
            onSelect={() => apply({ mode: 'dnd', minutes: 30 }, 'Do not disturb for 30 minutes')}
          >
            For 30 minutes
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => apply({ mode: 'dnd', minutes: 60 }, 'Do not disturb for 1 hour')}
          >
            For 1 hour
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              apply(
                { mode: 'dnd', minutes: untilTomorrow() },
                'Do not disturb until tomorrow morning',
              )
            }
          >
            Until tomorrow morning
          </DropdownMenuItem>
          {state === 'dnd' && (
            <DropdownMenuItem onSelect={() => apply({ mode: 'auto' }, 'Do not disturb is off')}>
              Turn off
            </DropdownMenuItem>
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}

export function UserMenu({ side = 'right' }: { side?: 'right' | 'bottom' }) {
  const { user, orgRole } = useMe();
  const signOut = useSignOut();
  const fallback = initials(user.name, user.email);
  const [statusOpen, setStatusOpen] = useState(false);
  useTrackPeople([user.id]);
  const state = usePresenceOf(user.id);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative size-9 rounded-full"
            aria-label="Account menu"
          >
            <Avatar className="size-8">
              {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
              <AvatarFallback className="text-xs">{fallback}</AvatarFallback>
            </Avatar>
            <PresenceDot state={state} className="absolute right-0 bottom-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side={side} className="w-64">
          <DropdownMenuLabel className="space-y-1 font-normal">
            <div className="truncate font-medium">{user.name ?? user.email}</div>
            <div className="text-muted-foreground truncate text-xs">{user.email}</div>
            <RoleBadge role={orgRole} />
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <StatusSection onSetStatus={() => setStatusOpen(true)} />
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/profile">
              <UserRound /> Your profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={signOut}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <StatusDialog open={statusOpen} onOpenChange={setStatusOpen} />
    </>
  );
}
