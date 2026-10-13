'use client';

import { Archive, Globe, Lock, Star } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { TONES, TonePill, type Tone } from '@/components/shared/pastel';
import { api, ApiError, type SpaceRole, type SpaceVisibility } from '@/lib/api';
import { spaceIcon } from '@/lib/space-icons';
import { cn } from '@/lib/utils';

const TONE_ORDER: Tone[] = ['blue', 'violet', 'green', 'orange', 'pink', 'amber'];

/** A stable colour per space, so the same space always looks the same. */
export function toneFor(key: string): Tone {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TONE_ORDER[h % TONE_ORDER.length]!;
}

export function SpaceIcon({
  icon,
  spaceKey,
  className,
}: {
  icon: string;
  spaceKey: string;
  className?: string;
}) {
  const Icon = spaceIcon(icon);
  return (
    <span
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-xl',
        TONES[toneFor(spaceKey)].pill,
        className,
      )}
    >
      <Icon className="size-5" aria-hidden />
    </span>
  );
}

export function VisibilityPill({ visibility }: { visibility: SpaceVisibility }) {
  return visibility === 'private' ? (
    <TonePill tone="violet" icon={Lock}>
      Private
    </TonePill>
  ) : (
    <TonePill tone="green" icon={Globe}>
      Open
    </TonePill>
  );
}

export const ArchivedPill = () => (
  <TonePill tone="amber" icon={Archive}>
    Archived
  </TonePill>
);

const ROLE_TONE: Record<SpaceRole, Tone> = { admin: 'blue', member: 'green', viewer: 'amber' };
export const SpaceRolePill = ({ role }: { role: SpaceRole }) => (
  <TonePill tone={ROLE_TONE[role]}>{role[0]!.toUpperCase() + role.slice(1)}</TonePill>
);

export function KeyChip({ spaceKey }: { spaceKey: string }) {
  return (
    <span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 font-mono text-xs">
      {spaceKey}
    </span>
  );
}

/** Star toggle shared by cards, rows and the space header. */
export function StarButton({
  id,
  starred,
  name,
  className,
}: {
  id: string;
  starred: boolean;
  name: string;
  className?: string;
}) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: () =>
      api<{ starred: boolean }>(`/spaces/${id}/star`, {
        method: 'POST',
        body: { starred: !starred },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['spaces'] });
      qc.invalidateQueries({ queryKey: ['space'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not update the star'),
  });
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className}
      aria-pressed={starred}
      aria-label={starred ? `Unstar ${name}` : `Star ${name}`}
      disabled={toggle.isPending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle.mutate();
      }}
    >
      <Star className={cn(starred && 'fill-amber-400 text-amber-500')} />
    </Button>
  );
}
