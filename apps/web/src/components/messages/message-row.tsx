'use client';

import { memo, useState } from 'react';
import {
  Bookmark,
  BookmarkCheck,
  Bot,
  CornerDownRight,
  Link2,
  MailOpen,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RotateCw,
  Trash2,
  TriangleAlert,
  X,
  SquareCheckBig,
} from 'lucide-react';
import type { AttachmentDTO, MessageDTO, PersonDTO } from '@crew-deck/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { personName, type MessageDoc } from '@/lib/messaging-api';
import { cn } from '@/lib/utils';
import { Composer } from './composer';
import { EmojiPickerButton } from './emoji-picker';
import { AttachmentList, PreviewCards, ReactionBar, ThreadSummaryLink } from './message-parts';
import { ItemCards } from './item-card';
import { PersonAvatar, StatusEmoji } from './person-avatar';
import { ProfilePopover } from './profile-popover';
import { RichContent } from './rich-content';
import type { PendingMessage } from './store';

/** Width of the avatar column; system lines indent by the same amount so everything lines up. */
export const AVATAR_COL = 'w-9';

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
  /** Everyone we know by id, for naming who reacted. */
  people: Map<string, PersonDTO>;
  /** Channel owner or org admin: may delete anyone's message. */
  canModerate: boolean;
  /** The conversation accepts changes (not archived, and I am in it). */
  canEdit: boolean;
  canReact: boolean;
  /** Replying in a thread is open to members even in announcement channels. */
  canReply: boolean;
  canPin: boolean;
  saved: boolean;
  /** Shown inside a thread panel: no thread summary or "reply in thread". */
  inThread?: boolean;
  editing: boolean;
  highlighted: boolean;
  onEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, doc: MessageDoc) => Promise<void>;
  onDelete: (m: MessageDTO) => void;
  onMarkUnread: (m: MessageDTO) => void;
  onCopyLink: (m: MessageDTO) => void;
  onReact: (m: MessageDTO, emoji: string) => void;
  onOpenThread: (m: MessageDTO) => void;
  onTogglePin: (m: MessageDTO) => void;
  onToggleSave: (m: MessageDTO) => void;
  onOpenImage: (images: AttachmentDTO[], index: number) => void;
  /** Turn the message into a work item. Absent when I cannot create work anywhere. */
  onCreateItem?: (m: MessageDTO) => void;
}

function HoverToolbar({
  m,
  own,
  canDelete,
  p,
}: {
  m: MessageDTO;
  own: boolean;
  canDelete: boolean;
  p: MessageRowProps;
}) {
  return (
    <div
      className="bg-background absolute -top-3.5 right-4 z-10 flex translate-y-1 scale-95 items-center rounded-md border p-0.5 opacity-0 shadow-sm transition duration-150 ease-out group-hover/row:translate-y-0 group-hover/row:scale-100 group-hover/row:opacity-100 group-focus-within/row:translate-y-0 group-focus-within/row:scale-100 group-focus-within/row:opacity-100 has-[[data-state=open]]:translate-y-0 has-[[data-state=open]]:scale-100 has-[[data-state=open]]:opacity-100 pointer-coarse:translate-y-0 pointer-coarse:scale-100 pointer-coarse:opacity-100"
      role="toolbar"
      aria-label="Message actions"
    >
      {p.canReact && <EmojiPickerButton onPick={(e) => p.onReact(m, e)} />}
      {p.canReply && !p.inThread && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Reply in thread"
              onClick={() => p.onOpenThread(m)}
            >
              <MessageSquare />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reply in thread</TooltipContent>
        </Tooltip>
      )}
      {own && p.canEdit && (
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
        <DropdownMenuContent align="end" className="min-w-52">
          {p.canReply && !p.inThread && (
            <DropdownMenuItem onSelect={() => p.onOpenThread(m)}>
              <MessageSquare /> Reply in thread
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => p.onToggleSave(m)}>
            {p.saved ? <BookmarkCheck /> : <Bookmark />}{' '}
            {p.saved ? 'Remove from saved' : 'Save for later'}
          </DropdownMenuItem>
          {p.canPin && (
            <DropdownMenuItem onSelect={() => p.onTogglePin(m)}>
              {m.pinned ? <PinOff /> : <Pin />} {m.pinned ? 'Unpin from channel' : 'Pin to channel'}
            </DropdownMenuItem>
          )}
          {p.onCreateItem && (
            <DropdownMenuItem onSelect={() => p.onCreateItem?.(m)}>
              <SquareCheckBig /> Create work item
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => p.onMarkUnread(m)}>
            <MailOpen /> Mark unread
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => p.onCopyLink(m)}>
            <Link2 /> Copy link
          </DropdownMenuItem>
          {(own && p.canEdit) || canDelete ? <DropdownMenuSeparator /> : null}
          {own && p.canEdit && (
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
  // Only a message that has just arrived slides in; rows re-created by scrolling history stay still.
  const [fresh] = useState(() => Date.now() - new Date(p.message.createdAt).getTime() < 4000);
  const own = m.authorId === p.selfId && m.kind === 'user';
  const name = m.author
    ? personName(m.author)
    : m.kind === 'bot'
      ? (m.bot?.name ?? 'Bot')
      : 'Former member';

  // Joins, leaves and topic changes: one quiet line.
  if (m.kind === 'system') {
    return (
      <div
        id={`msg-${m.seq}`}
        className="text-muted-foreground flex items-center gap-2 px-4 py-1.5 pl-[4.75rem] text-label sm:px-5 sm:pl-[5.25rem]"
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
  const mentionsMe =
    !own &&
    !deleted &&
    m.mentions.some(
      (x) => (x.type === 'user' && x.id === p.selfId) || x.type === 'channel' || x.type === 'here',
    );
  // A thread reply that was also sent to the channel says where it came from.
  const alsoFromThread = !p.inThread && m.threadRootId && m.alsoInChannel;

  return (
    <article
      id={`msg-${m.seq}`}
      aria-label={`${name} at ${timeOf(m.createdAt)}`}
      className={cn(
        fresh && 'animate-fade-up',
        'group/row relative flex gap-3 px-4 transition-colors duration-150 hover:bg-muted/50 focus-within:bg-muted/50 sm:px-5',
        p.grouped ? 'py-0.5' : 'pt-3 pb-0.5',
        mentionsMe &&
          'border-l-2 border-warning bg-warning-soft pl-3.5 hover:bg-warning-soft sm:pl-4.5',
        p.highlighted && 'bg-primary/10 hover:bg-primary/10',
      )}
    >
      <div className={cn('flex shrink-0 justify-center pt-0.5', AVATAR_COL)}>
        {p.grouped ? (
          <time
            dateTime={m.createdAt}
            title={fullTime(m.createdAt)}
            className="text-muted-foreground pt-0.5 text-xs leading-5 opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
          >
            {timeOf(m.createdAt)}
          </time>
        ) : m.author ? (
          <ProfilePopover person={m.author}>
            <button
              type="button"
              aria-label={`Profile of ${name}`}
              className="focus-visible:ring-ring/50 rounded-full outline-none transition-transform duration-150 hover:scale-105 focus-visible:ring-2 active:scale-95"
            >
              <PersonAvatar person={m.author} presence={false} />
            </button>
          </ProfilePopover>
        ) : (
          <PersonAvatar person={m.author} presence={false} />
        )}
      </div>
      <div className="min-w-0 flex-1 pb-0.5">
        {m.pinned && !deleted && (
          <p className="text-muted-foreground mb-0.5 flex items-center gap-1 text-xs">
            <Pin className="size-3" aria-hidden /> Pinned
          </p>
        )}
        {!p.grouped && (
          <header className="flex items-baseline gap-2">
            {m.author && m.kind === 'user' ? (
              <ProfilePopover person={m.author}>
                <button
                  type="button"
                  className={cn(
                    'focus-visible:ring-ring/50 rounded-sm text-sm font-semibold outline-none hover:underline focus-visible:ring-2',
                    m.author.deactivated && 'text-muted-foreground',
                  )}
                >
                  {name}
                </button>
              </ProfilePopover>
            ) : (
              <span className="text-sm font-semibold">{name}</span>
            )}
            {m.kind === 'user' && <StatusEmoji userId={m.author?.id} className="text-sm" />}
            {m.author?.deactivated && (
              <span className="text-muted-foreground text-xs">(deactivated)</span>
            )}
            {m.kind === 'bot' && (
              <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-sm px-1 text-xs font-medium uppercase">
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
            {alsoFromThread && (
              <button
                type="button"
                onClick={() => p.onOpenThread(m)}
                className="text-muted-foreground hover:text-primary text-xs hover:underline"
              >
                replied to a thread
              </button>
            )}
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
          <p className="text-muted-foreground text-label italic">This message was deleted</p>
        ) : (
          <>
            {(m.bodyText || m.attachments.length === 0) && (
              <div className="flex items-end gap-1.5">
                <RichContent doc={m.body} />
                {m.editedAt && (
                  <span
                    className="text-muted-foreground shrink-0 text-xs"
                    title={`Edited ${fullTime(m.editedAt)}`}
                  >
                    (edited)
                  </span>
                )}
              </div>
            )}
            <AttachmentList attachments={m.attachments} onOpenImage={p.onOpenImage} />
            <ItemCards items={m.workItems ?? []} />
            <PreviewCards previews={m.previews} pending={m.previewsPending} />
            <ReactionBar
              message={m}
              selfId={p.selfId}
              people={p.people}
              canReact={p.canReact}
              onToggle={(emoji) => p.onReact(m, emoji)}
            />
            {!p.inThread && <ThreadSummaryLink message={m} onOpen={() => p.onOpenThread(m)} />}
          </>
        )}
      </div>
      {!p.editing && !deleted && <HoverToolbar m={m} own={own} canDelete={canDelete} p={p} />}
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
      className={cn('flex gap-3 px-4 sm:px-5', grouped ? 'py-0.5' : 'pt-3 pb-0.5')}
    >
      <div className={cn('flex shrink-0 justify-center pt-0.5', AVATAR_COL)}>
        {!grouped && <PersonAvatar person={self} presence={false} />}
      </div>
      <div className="min-w-0 flex-1 pb-0.5">
        {!grouped && (
          <header className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">{personName(self)}</span>
            <time className="text-muted-foreground text-xs">{timeOf(pending.createdAt)}</time>
          </header>
        )}
        <div className={cn('transition-opacity duration-300', !failed && 'opacity-60')}>
          {pending.text && <RichContent doc={pending.body} />}
          {pending.files?.length ? (
            <ul className="mt-1 flex flex-wrap gap-1.5 text-label">
              {pending.files.map((f) => (
                <li key={f.id} className="bg-muted rounded-md px-2 py-1">
                  {f.name}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {failed && (
          <div
            role="alert"
            className="border-destructive/40 bg-destructive/10 text-destructive mt-1 flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-label"
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
