'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { MessageDTO } from '@crew-deck/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useMe } from '@/components/shell/me-context';
import { api, ApiError, qs, type Page, type Space } from '@/lib/api';
import { linkItemToMessage, refreshItemCards } from '@/lib/messaging-api';
import { keys } from '@/lib/messaging-api';

const TYPES = [
  { value: 'task', label: 'Task' },
  { value: 'bug', label: 'Bug' },
  { value: 'story', label: 'Story' },
] as const;

/** Spaces where I can create work: a role of member or admin, or a workspace admin. */
export function useCreatableSpaces() {
  const me = useMe();
  const isAdmin = me.permissions.includes('settings.manage');
  const q = useQuery({
    queryKey: ['spaces', { creatable: true }],
    queryFn: () => api<Page<Space>>(`/spaces${qs({ pageSize: 100 })}`),
    staleTime: 60_000,
  });
  const spaces = useMemo(
    () =>
      (q.data?.items ?? []).filter(
        (s) => s.status === 'active' && (isAdmin || s.myRole === 'admin' || s.myRole === 'member'),
      ),
    [q.data, isAdmin],
  );
  return { spaces, isLoading: q.isLoading };
}

const firstLine = (text: string) =>
  (text.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 200);

/**
 * "Create work item" on a message: title from the first line, the message as the description with a
 * link back, and the channel's space preselected (otherwise pick one). The item is made through the
 * normal create endpoint, then tied to the message so the Tasks bot can answer in its thread.
 */
export function CreateWorkDialog({
  message,
  prefillTitle = '',
  defaultSpaceId,
  spaces,
  open,
  onOpenChange,
}: {
  /** The message being turned into work. Absent for `/task create`, which only prefills a title. */
  message: MessageDTO | null;
  prefillTitle?: string;
  defaultSpaceId: string | null;
  spaces: Space[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [spaceId, setSpaceId] = useState('');
  const [type, setType] = useState<string>('task');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [titleError, setTitleError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (message) {
      const text = message.bodyText ?? '';
      const link = `${window.location.origin}/messages/${message.channelId}?m=${message.seq}`;
      setTitle(firstLine(text));
      setDescription(`${text.slice(0, 3000)}\n\nFrom chat: ${link}`);
    } else {
      setTitle(prefillTitle.slice(0, 200));
      setDescription('');
    }
    setType('task');
    setTitleError('');
    setError('');
    setSpaceId(
      spaces.find((s) => s.id === defaultSpaceId)?.id ?? (spaces.length === 1 ? spaces[0]!.id : ''),
    );
  }, [open, message, prefillTitle, defaultSpaceId, spaces]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setTitleError('Enter a title');
    const space = spaces.find((s) => s.id === spaceId);
    if (!space) return setError('Choose the space this belongs in');
    setBusy(true);
    setError('');
    try {
      const item = await api<{ id: string; key: string }>(`/spaces/${space.key}/items`, {
        method: 'POST',
        body: { type, title: title.trim(), description: description.trim() || undefined },
      });
      if (message) {
        try {
          await linkItemToMessage(message.id, item.id);
        } catch {
          toast.message(`${item.key} was created, but could not be linked to the message`);
        }
        void qc.invalidateQueries({
          queryKey: ['messaging', 'thread', message.threadRootId ?? message.id],
        });
        void qc.invalidateQueries({ queryKey: keys.messages(message.channelId) });
      }
      refreshItemCards(qc);
      void qc.invalidateQueries({ queryKey: ['work'] });
      toast.success(`Created ${item.key}`, {
        action: {
          label: 'Open',
          onClick: () => (window.location.href = `/spaces/${space.key}/items/${item.key}`),
        },
      });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the work item');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create work item</DialogTitle>
          <DialogDescription>
            {message
              ? 'Turn this message into work. A link back to the conversation is added to the description.'
              : 'Create a work item without leaving the conversation.'}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <div className="space-y-1.5">
              <Label htmlFor="cw-space">Space</Label>
              <Select value={spaceId} onValueChange={setSpaceId}>
                <SelectTrigger id="cw-space">
                  <SelectValue placeholder="Choose a space" />
                </SelectTrigger>
                <SelectContent>
                  {spaces.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.key})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cw-type">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="cw-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cw-title">Title</Label>
            <Input
              id="cw-title"
              value={title}
              maxLength={200}
              aria-invalid={!!titleError}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleError('');
              }}
            />
            {titleError && <p className="text-destructive text-xs">{titleError}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cw-desc">Description</Label>
            <Textarea
              id="cw-desc"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Create work item
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
