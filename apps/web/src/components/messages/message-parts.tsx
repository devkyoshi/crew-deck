'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  MessageSquare,
  X,
} from 'lucide-react';
import type { AttachmentDTO, LinkPreviewDTO, MessageDTO, PersonDTO } from '@crew-deck/shared';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { personName } from '@/lib/messaging-api';
import { cn } from '@/lib/utils';
import { EmojiPickerButton } from './emoji-picker';
import { PersonAvatar } from './person-avatar';

// ---- Reactions -----------------------------------------------------------------------------------------

const names = (ids: string[], people: Map<string, PersonDTO>, selfId: string) => {
  const list = ids.map((id) => (id === selfId ? 'You' : personName(people.get(id)).split(' ')[0]));
  if (list.length <= 3) return list.join(', ');
  return `${list.slice(0, 3).join(', ')} and ${list.length - 3} more`;
};

/** Reaction chips under a message: click one to add or remove your own; the tooltip says who reacted. */
export function ReactionBar({
  message,
  selfId,
  people,
  canReact,
  onToggle,
}: {
  message: MessageDTO;
  selfId: string;
  people: Map<string, PersonDTO>;
  canReact: boolean;
  onToggle: (emoji: string) => void;
}) {
  const reduce = useReducedMotion();
  if (message.reactions.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Reactions">
      <AnimatePresence initial={false}>
        {message.reactions.map((r) => {
          const mine = r.userIds.includes(selfId);
          return (
            <motion.span
              key={r.emoji}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduce ? undefined : { opacity: 0, scale: 0.6 }}
              transition={{ type: 'spring', stiffness: 520, damping: 30 }}
              className="inline-flex"
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-pressed={mine}
                    aria-label={`${r.emoji} ${r.count}. ${names(r.userIds, people, selfId)} reacted`}
                    disabled={!canReact}
                    onClick={() => onToggle(r.emoji)}
                    className={cn(
                      'focus-visible:ring-ring/50 inline-flex h-6 items-center gap-1 rounded-full border px-2 text-label transition-[colors,transform] duration-150 outline-none focus-visible:ring-2 enabled:active:scale-90 disabled:cursor-default',
                      mine
                        ? 'border-primary/50 bg-primary/10 text-primary'
                        : 'bg-muted/50 hover:bg-muted',
                    )}
                  >
                    <span className="text-heading leading-none">{r.emoji}</span>
                    <span className="relative inline-flex overflow-hidden tabular-nums">
                      <AnimatePresence mode="popLayout" initial={false}>
                        <motion.span
                          key={r.count}
                          initial={reduce ? false : { y: 10, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          exit={reduce ? undefined : { y: -10, opacity: 0 }}
                          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                        >
                          {r.count}
                        </motion.span>
                      </AnimatePresence>
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {names(r.userIds, people, selfId)} reacted with {r.emoji}
                </TooltipContent>
              </Tooltip>
            </motion.span>
          );
        })}
      </AnimatePresence>
      {canReact && <EmojiPickerButton onPick={onToggle} className="size-6 rounded-full border" />}
    </div>
  );
}

// ---- Thread summary --------------------------------------------------------------------------------------

const ago = (iso: string) => {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hr ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
};

/** Under a root message: who replied, how many, and when. Opens the thread. */
export function ThreadSummaryLink({
  message,
  onOpen,
}: {
  message: MessageDTO;
  onOpen: () => void;
}) {
  if (message.replyCount === 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="hover:bg-background focus-visible:ring-ring/50 group/thread mt-1 flex max-w-full items-center gap-2 rounded-md border border-transparent px-1 py-0.5 text-left text-label outline-none hover:border-border focus-visible:ring-[3px]"
    >
      <span className="flex -space-x-1.5">
        {message.replyAuthors.map((p) => (
          <PersonAvatar
            key={p.id}
            person={p}
            size="sm"
            presence={false}
            className="ring-background rounded-full ring-2"
          />
        ))}
      </span>
      <span className="text-primary font-medium">
        {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
      </span>
      {message.lastReplyAt && (
        <span className="text-muted-foreground">Last reply {ago(message.lastReplyAt)}</span>
      )}
      <MessageSquare
        className="text-muted-foreground size-3.5 opacity-0 group-hover/thread:opacity-100"
        aria-hidden
      />
    </button>
  );
}

// ---- Files -------------------------------------------------------------------------------------------------

export const formatSize = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Images show inline in a fixed box (so nothing moves when they load); other files are download cards. */
export function AttachmentList({
  attachments,
  onOpenImage,
}: {
  attachments: AttachmentDTO[];
  onOpenImage: (images: AttachmentDTO[], index: number) => void;
}) {
  if (attachments.length === 0) return null;
  const images = attachments.filter((a) => a.isImage);
  const files = attachments.filter((a) => !a.isImage);
  return (
    <div className="mt-1.5 space-y-1.5">
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Images">
          {images.map((a, i) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onOpenImage(images, i)}
                aria-label={`View ${a.name}`}
                className="bg-muted focus-visible:ring-ring/50 block h-44 w-64 overflow-hidden rounded-lg border outline-none focus-visible:ring-[3px]"
              >
                <img src={a.url} alt={a.name} loading="lazy" className="size-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Files">
          {files.map((a) => (
            <li key={a.id}>
              <a
                href={a.url}
                download={a.name}
                className="hover:bg-muted/60 focus-visible:ring-ring/50 flex w-64 items-center gap-3 rounded-lg border px-3 py-2 outline-none focus-visible:ring-[3px]"
              >
                <FileText className="text-muted-foreground size-8 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{a.name}</span>
                  <span className="text-muted-foreground block text-xs">{formatSize(a.size)}</span>
                </span>
                <Download className="text-muted-foreground size-4 shrink-0" aria-label="Download" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Full-screen image viewer with arrow-key navigation. */
export function ImageLightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: AttachmentDTO[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const current = images[index];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') onIndex((index + 1) % images.length);
      if (e.key === 'ArrowLeft') onIndex((index - 1 + images.length) % images.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, images.length, onIndex]);
  if (!current) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="h-[90dvh] max-w-[95vw] gap-0 border-0 bg-black/90 p-0 sm:max-w-[95vw]"
      >
        <DialogTitle className="sr-only">{current.name}</DialogTitle>
        <DialogDescription className="sr-only">
          Image {index + 1} of {images.length}. Use the left and right arrow keys to move between
          images.
        </DialogDescription>
        <div className="relative flex size-full items-center justify-center p-4">
          <img
            src={current.url}
            alt={current.name}
            className="max-h-full max-w-full rounded-sm object-contain"
          />
          <div className="absolute top-3 right-3 flex gap-2">
            <a
              href={current.url}
              download={current.name}
              aria-label="Download"
              className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            >
              <Download className="size-5" />
            </a>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            >
              <X className="size-5" />
            </button>
          </div>
          {images.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous image"
                onClick={() => onIndex((index - 1 + images.length) % images.length)}
                className="absolute left-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
              >
                <ChevronLeft className="size-6" />
              </button>
              <button
                type="button"
                aria-label="Next image"
                onClick={() => onIndex((index + 1) % images.length)}
                className="absolute right-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
              >
                <ChevronRight className="size-6" />
              </button>
            </>
          )}
          <p className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-sm text-white">
            {current.name}
            {images.length > 1 && ` · ${index + 1} / ${images.length}`}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- Link previews ----------------------------------------------------------------------------------------

/** A card per link. While links are being looked up a same-size placeholder holds the space. */
export function PreviewCards({
  previews,
  pending,
}: {
  previews: LinkPreviewDTO[];
  pending: boolean;
}) {
  if (previews.length === 0 && !pending) return null;
  return (
    <ul className="mt-1.5 space-y-1.5" aria-label="Link previews">
      {pending && previews.length === 0 && (
        <li className="bg-muted/40 h-[88px] max-w-md animate-pulse rounded-lg border" aria-hidden />
      )}
      {previews.map((p) => (
        <li key={p.url}>
          <a
            href={p.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="hover:bg-muted/40 focus-visible:ring-ring/50 flex h-[88px] max-w-md items-stretch gap-3 overflow-hidden rounded-lg border border-l-4 border-l-primary/60 p-2 outline-none focus-visible:ring-[3px]"
          >
            <span className="min-w-0 flex-1">
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                {p.siteName ?? new URL(p.url).hostname}
                <ExternalLink className="size-3" aria-hidden />
              </span>
              <span className="line-clamp-1 text-sm font-semibold">{p.title ?? p.url}</span>
              {p.description && (
                <span className="text-muted-foreground line-clamp-2 text-label">
                  {p.description}
                </span>
              )}
            </span>
            {p.imageUrl && <PreviewImage src={p.imageUrl} />}
          </a>
        </li>
      ))}
    </ul>
  );
}

function PreviewImage({ src }: { src: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    // The picture lives on someone else's server: no referrer is sent, and a broken one just disappears.
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setBroken(true)}
      className="bg-muted size-[72px] shrink-0 rounded-md object-cover"
    />
  );
}
