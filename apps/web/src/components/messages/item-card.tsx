'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';
import type { ItemCardDTO } from '@crew-deck/shared';
import { PriorityIcon, StatusChip, TypeIcon, UserAvatar } from '@/components/work/work-bits';
import type { StatusColor } from '@/lib/work';
import { useItemCard } from '@/lib/messaging-api';
import { cn } from '@/lib/utils';

/** Every card is the same height, loading or loaded, so nothing moves when it arrives. */
const SHELL = 'flex h-[60px] max-w-md items-center gap-3 rounded-lg border px-3';

/** The card as the server describes it to this viewer. Also used for ephemeral command replies. */
export function ItemCardView({ card, className }: { card: ItemCardDTO; className?: string }) {
  if (!card.access) {
    return (
      <div className={cn(SHELL, 'text-muted-foreground bg-muted/30', className)}>
        <Lock className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 text-sm">
          <span className="text-foreground font-medium">{card.key}</span> · You do not have access to
          this work item
        </span>
      </div>
    );
  }
  return (
    <Link
      href={card.href}
      className={cn(
        SHELL,
        'hover:bg-muted/40 focus-visible:ring-ring/50 border-l-4 border-l-primary/60 outline-none focus-visible:ring-[3px]',
        className,
      )}
    >
      <TypeIcon type={card.type} size="md" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs font-medium">{card.key}</span>
          <StatusChip
            name={card.status.name}
            category={card.status.category}
            color={(card.status.color ?? undefined) as StatusColor | undefined}
          />
        </span>
        <span className="line-clamp-1 text-sm font-semibold">{card.title}</span>
      </span>
      <PriorityIcon priority={card.priority} />
      <UserAvatar person={card.assignee ? { ...card.assignee, email: '' } : null} size={22} />
    </Link>
  );
}

/** A work item named in a message: its live card, or a placeholder of the same size while it loads. */
export function ItemCard({ itemKey }: { itemKey: string }) {
  const q = useItemCard(itemKey);
  if (q.isLoading)
    return <div className={cn(SHELL, 'bg-muted/40 animate-pulse')} aria-hidden />;
  if (q.isError || !q.data) return <ItemCardView card={{ access: false, key: itemKey }} />;
  return <ItemCardView card={q.data} />;
}

export function ItemCards({ items }: { items: { id: string; key: string }[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-1.5" aria-label="Work items">
      {items.map((i) => (
        <li key={i.id}>
          <ItemCard itemKey={i.key} />
        </li>
      ))}
    </ul>
  );
}
