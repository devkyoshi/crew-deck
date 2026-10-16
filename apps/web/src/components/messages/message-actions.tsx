'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AttachmentDTO, MessageDTO, PersonDTO } from '@crew-deck/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useMe } from '@/components/shell/me-context';
import { ApiError } from '@/lib/api';
import {
  patchMessageEverywhere,
  useDeleteMessage,
  useEditMessage,
  useMarkUnread,
  useSavedIds,
  useSetPinned,
  useSetSaved,
  type channelPerms,
  type MessageDoc,
} from '@/lib/messaging-api';
import { ImageLightbox } from './message-parts';
import type { MessageRowProps } from './message-row';
import { usePanel } from './panel';
import { useRealtime } from './realtime';

type Perms = ReturnType<typeof channelPerms>;

/**
 * Everything a message can do (react, reply, pin, save, edit, delete, copy link, mark unread, open an
 * image), in one place, so the channel view, thread panel, pins and saved lists all behave alike.
 * `nodes` holds the dialogs those actions need and must be rendered once by the caller.
 */
export function useMessageActions({
  channelId,
  perms,
  people,
  inThread = false,
}: {
  channelId: string;
  perms: Perms;
  people: Map<string, PersonDTO>;
  inThread?: boolean;
}) {
  const me = useMe().user;
  const qc = useQueryClient();
  const rt = useRealtime();
  const panel = usePanel();
  const savedIds = useSavedIds();
  const pin = useSetPinned(channelId);
  const save = useSetSaved();
  const edit = useEditMessage();
  const del = useDeleteMessage();
  const markUnread = useMarkUnread();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<MessageDTO | null>(null);
  const [lightbox, setLightbox] = useState<{ images: AttachmentDTO[]; index: number } | null>(null);

  const rowProps = useCallback(
    (m: MessageDTO, o: { grouped: boolean; highlighted?: boolean }): MessageRowProps => ({
      message: m,
      grouped: o.grouped,
      highlighted: o.highlighted ?? false,
      selfId: me.id,
      people,
      canModerate: perms.canModerate,
      canEdit: perms.member && !perms.isArchived,
      canReact: perms.canReact,
      canReply: perms.canReply,
      canPin: perms.canPin,
      saved: savedIds.has(m.id),
      inThread,
      editing: editingId === m.id,
      onEdit: setEditingId,
      onCancelEdit: () => setEditingId(null),
      onSaveEdit: async (id: string, doc: MessageDoc) => {
        try {
          const { message } = await edit.mutateAsync({ id, body: doc });
          patchMessageEverywhere(qc, id, () => message);
          setEditingId(null);
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : 'Could not save your change');
          throw e;
        }
      },
      onDelete: setToDelete,
      onMarkUnread: (x) =>
        markUnread.mutate(x.id, {
          onSuccess: () => toast.success('Marked as unread from this message'),
          onError: () => toast.error('Could not mark as unread'),
        }),
      onCopyLink: (x) => {
        const url = `${window.location.origin}/messages/${channelId}?m=${x.seq}`;
        void navigator.clipboard
          ?.writeText(url)
          .then(() => toast.success('Link copied'))
          .catch(() => toast.error('Could not copy the link'));
      },
      onReact: (x, emoji) => void rt.react(x, emoji),
      onOpenThread: (x) => panel.openThread(channelId, x.threadRootId ?? x.id),
      onTogglePin: (x) =>
        pin.mutate(
          { messageId: x.id, pinned: !x.pinned },
          {
            onSuccess: () => toast.success(x.pinned ? 'Unpinned' : 'Pinned to the channel'),
            onError: (e) =>
              toast.error(e instanceof ApiError ? e.message : 'Could not change the pin'),
          },
        ),
      onToggleSave: (x) =>
        save.mutate(
          { messageId: x.id, saved: !savedIds.has(x.id) },
          {
            onSuccess: () =>
              toast.success(savedIds.has(x.id) ? 'Removed from saved' : 'Saved for later'),
            onError: () => toast.error('Could not save the message'),
          },
        ),
      onOpenImage: (images, index) => setLightbox({ images, index }),
    }),
    [
      me.id,
      people,
      perms,
      savedIds,
      inThread,
      editingId,
      edit,
      qc,
      markUnread,
      channelId,
      rt,
      panel,
      pin,
      save,
    ],
  );

  const nodes: ReactNode = (
    <>
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this message?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed for everyone, with its files and reactions. A note that a message was
              deleted stays in its place.
              {toDelete?.bodyText && (
                <span className="bg-muted text-foreground mt-3 line-clamp-3 block rounded-md p-2 text-left italic">
                  “{toDelete.bodyText}”
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() => {
                const m = toDelete;
                if (!m) return;
                del.mutate(m.id, {
                  onSuccess: ({ message }) => patchMessageEverywhere(qc, m.id, () => message),
                  onError: (e) =>
                    toast.error(e instanceof ApiError ? e.message : 'Could not delete the message'),
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          onIndex={(index) => setLightbox({ ...lightbox, index })}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );

  return { rowProps, nodes, editingId, setEditingId };
}
