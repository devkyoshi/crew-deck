'use client';

import { memo } from 'react';
import {
  Bot,
  CornerDownRight,
  Link2,
  MailOpen,
  MoreHorizontal,
  Pencil,
  RotateCw,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { MessageDTO } from '@crew-deck/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { personName } from '@/lib/messaging-api';
import { cn } from '@/lib/utils';
import { Composer } from './composer';
import { PersonAvatar } from './person-avatar';
import { RichContent } from './rich-content';
import type { PendingMessage } from './store';
import type { PersonDTO } from '@crew-deck/shared';

export const timeOf = (iso: string | number) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fullTime = (iso: string) =>
  new Date(iso).toLocaleString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });

export interface MessageRowProps {
  message: MessageDTO;
  /** Same author as the message above within five minutes: no avatar or name. */
  grouped: boolean;
  selfId: string;
  /** Channel owner or org admin: may delete anyone's message. */
  canModerate: boolean;
  /** The conversation accepts changes (not archived, and I am in it). */
  canEdit: boolean;
  editing: boolean;
  highlighted: boolean;
  onEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (
    id: string,
    doc: Parameters<React.ComponentProps<typeof Composer>['onSubmit']>[0],
  ) => Promise<void>;
  onDelete: (m: MessageDTO) => void;
  onMarkUnread: (m: MessageDTO) => void;
  onCopyLink: (m: MessageDTO) => void;
}

function HoverToolbar({
  m,
  own,
  canEdit,
  canDelete,
  p,
}: {
  m: MessageDTO;
  own: boolean;
  canEdit: boolean;
  canDelete: boolean;
  p: MessageRowProps;
}) {
  return (
    <div
      className="bg-background absolute -top-3.5 right-4 z-10 flex items-center rounded-md border p-0.5 opacity-0 shadow-sm transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 has-[[data-state=open]]:opacity-100"
      role="toolbar"
      aria-label="Message actions"
    >
      {own && canEdit && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Edit message"
              onClick={() => p.onEdit(m.id)}
            >
              <Pencil />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>More</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem onSelect={() => p.onMarkUnread(m)}>
            <MailOpen /> Mark unread
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => p.onCopyLink(m)}>
            <Link2 /> Copy link
          </DropdownMenuItem>
          {(own && canEdit) || canDelete ? <DropdownMenuSeparator /> : null}
          {own && canEdit && (
            <DropdownMenuItem onSelect={() => p.onEdit(m.id)}>
              <Pencil /> Edit message
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem variant="destructive" onSelect={() => p.onDelete(m)}>
              <Trash2 /> Delete message
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export const MessageRow = memo(function MessageRow(p: MessageRowProps) {
  const m = p.message;
  const own = m.authorId === p.selfId && m.kind === 'user';
  const name = m.author ? personName(m.author) : m.kind === 'bot' ? 'Bot' : 'Former member';

  // Joins, leaves and topic changes: one quiet line.
  if (m.kind === 'system') {
    return (
      <div
        id={`msg-${m.seq}`}
        className="text-muted-foreground flex items-center gap-2 px-4 py-1 pl-16 text-[13px]"
      >
        <CornerDownRight className="size-3.5 shrink-0" aria-hidden />
        <span>
          <span className="text-foreground/80 font-medium">{name}</span> {m.bodyText}
        </span>
        <time dateTime={m.createdAt} className="ml-1 text-xs opacity-70">
          {timeOf(m.createdAt)}
        </time>
      </div>
    );
  }

  const deleted = !!m.deletedAt;
  const canDelete = !deleted && p.canEdit && (own || p.canModerate);

  return (
    <article
      id={`msg-${m.seq}`}
      aria-label={`${name} at ${timeOf(m.createdAt)}`}
      className={cn(
        'group/row relative flex gap-3 px-4 transition-colors hover:bg-muted/50 focus-within:bg-muted/50',
        p.grouped ? 'py-px' : 'pt-2 pb-px',
        p.highlighted && 'bg-primary/10 hover:bg-primary/10',
      )}
    >
      <div className="flex w-9 shrink-0 justify-center pt-0.5">
        {p.grouped ? (
          <time
            dateTime={m.createdAt}
            title={fullTime(m.createdAt)}
            className="text-muted-foreground pt-0.5 text-[10px] leading-5 opacity-0 group-hover/row:opacity-100"
          >
            {timeOf(m.createdAt)}
          </time>
        ) : (
          <PersonAvatar person={m.author} presence={false} />
        )}
      </div>
      <div className="min-w-0 flex-1 pb-0.5">
        {!p.grouped && (
          <header className="flex items-baseline gap-2">
            <span
              className={cn(
                'text-[14px] font-semibold',
                m.author?.deactivated && 'text-muted-foreground',
              )}
            >
              {name}
            </span>
            {m.author?.deactivated && (
              <span className="text-muted-foreground text-xs">(deactivated)</span>
            )}
            {m.kind === 'bot' && (
              <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded px-1 text-[10px] font-medium uppercase">
                <Bot className="size-3" /> Bot
              </span>
            )}
            <time
              dateTime={m.createdAt}
              title={fullTime(m.createdAt)}
              className="text-muted-foreground text-xs"
            >
              {timeOf(m.createdAt)}
            </time>
          </header>
        )}
        {p.editing && !deleted ? (
          <Composer
            autoFocus
            initialDoc={m.body as never}
            submitLabel="Save changes"
            onCancel={p.onCancelEdit}
            onSubmit={(doc) => p.onSaveEdit(m.id, doc)}
            className="mt-1"
          />
        ) : deleted ? (
          <p className="text-muted-foreground text-[13px] italic">This message was deleted</p>
        ) : (
          <div className="flex items-end gap-1.5">
            <RichContent doc={m.body} />
            {m.editedAt && (
              <span
                className="text-muted-foreground shrink-0 text-[11px]"
                title={`Edited ${fullTime(m.editedAt)}`}
              >
                (edited)
              </span>
            )}
          </div>
        )}
      </div>
      {!p.editing && !deleted && (
        <HoverToolbar m={m} own={own} canEdit={p.canEdit} canDelete={canDelete} p={p} />
      )}
    </article>
  );
});

/** A message that has not been acknowledged yet: dimmed while sending, a red bar with Retry if it failed. */
export function PendingRow({
  pending,
  self,
  grouped,
  onRetry,
  onDiscard,
}: {
  pending: PendingMessage;
  self: PersonDTO;
  grouped: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const failed = pending.status === 'failed';
  return (
    <article
      aria-label={failed ? 'Message not sent' : 'Sending message'}
      className={cn('flex gap-3 px-4', grouped ? 'py-px' : 'pt-2 pb-px')}
    >
      <div className="flex w-9 shrink-0 justify-center pt-0.5">
        {!grouped && <PersonAvatar person={self} presence={false} />}
      </div>
      <div className="min-w-0 flex-1 pb-0.5">
        {!grouped && (
          <header className="flex items-baseline gap-2">
            <span className="text-[14px] font-semibold">{personName(self)}</span>
            <time className="text-muted-foreground text-xs">{timeOf(pending.createdAt)}</time>
          </header>
        )}
        <div className={cn(!failed && 'opacity-60')}>
          <RichContent doc={pending.body} />
        </div>
        {failed && (
          <div
            role="alert"
            className="border-destructive/40 bg-destructive/10 text-destructive mt-1 flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-[13px]"
          >
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">{pending.error ?? 'Not sent.'}</span>
            <Button size="xs" variant="outline" onClick={onRetry}>
              <RotateCw /> Retry
            </Button>
            <Button size="xs" variant="ghost" onClick={onDiscard} aria-label="Discard message">
              <X /> Discard
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}
