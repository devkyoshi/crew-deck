'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  BellOff,
  Check,
  FileText,
  ImageIcon,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { LinkType } from '@crew-deck/shared';
import {
  isEmptyDoc,
  RichTextEditor,
  RichTextView,
  type RichDoc,
  type RichTextEditorHandle,
} from '@/components/shared/rich-text';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadError } from '@/components/shared/load-error';
import { useMe } from '@/components/shell/me-context';
import { api, qs, type Page, type Space } from '@/lib/api';
import type { WorkItem } from '@/lib/work';
import { errorText, searchAssignees } from '@/lib/work-api';
import {
  LINK_OPTIONS,
  uploadAttachment,
  useActivity,
  useAddComment,
  useAddLink,
  useAttachments,
  useAttachmentsChanged,
  useComments,
  useDeleteAttachment,
  useDeleteComment,
  useDuplicateItem,
  useEditComment,
  useLinks,
  useRemoveLink,
  useToggleWatch,
  useTransferItem,
  useWatchers,
  type ActivityEvent,
  type Comment,
} from '@/lib/work-depth-api';
import { cn } from '@/lib/utils';
import { useVocabulary } from './use-vocabulary';
import { StatusChip, TypeIcon, UserAvatar } from './work-bits';
import { ItemPicker } from './work-pickers';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const sizeText = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const nameOf = (p: { name: string | null; email: string } | null) => (p ? (p.name ?? p.email) : 'Someone');

// ---- Description ----------------------------------------------------------------------------------------

/** Saves about a second after typing stops, and on leaving the editor. */
export function DescriptionEditor({
  item,
  canEdit,
  onSave,
}: {
  item: WorkItem;
  canEdit: boolean;
  onSave: (doc: RichDoc | null) => void;
}) {
  const server = (item.descriptionDoc ?? null) as RichDoc | null;
  const [draft, setDraft] = useState<RichDoc | null>(server);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(JSON.stringify(server));

  useEffect(() => {
    lastSaved.current = JSON.stringify(server);
  }, [item.id, item.updatedAt]);

  const flush = (doc: RichDoc | null) => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    const json = JSON.stringify(doc);
    if (json === lastSaved.current) return;
    lastSaved.current = json;
    onSave(doc);
  };
  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current);
  }, []);

  if (!canEdit) {
    return isEmptyDoc(server) ? (
      <p className="text-muted-foreground text-sm">No description</p>
    ) : (
      <RichTextView doc={server} className="text-sm" />
    );
  }
  return (
    <RichTextEditor
      label="Description"
      value={draft ?? server}
      placeholder="Add a description… Type @ to mention someone."
      searchPeople={(q) => searchAssignees(item.spaceKey, q)}
      onChange={(doc) => {
        setDraft(doc);
        if (pending.current) clearTimeout(pending.current);
        pending.current = setTimeout(() => flush(doc), 900);
      }}
      onBlur={() => flush(draft)}
      className="text-sm"
    />
  );
}

// ---- Watch toggle ---------------------------------------------------------------------------------------

export function WatchButton({ itemId }: { itemId: string }) {
  const watchers = useWatchers(itemId);
  const toggle = useToggleWatch(itemId);
  const watching = !!watchers.data?.watching;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      disabled={!watchers.data || toggle.isPending}
      aria-pressed={watching}
      aria-label={watching ? 'Stop watching' : 'Watch'}
      title={watching ? 'Stop watching' : 'Watch for changes'}
      onClick={() =>
        toggle.mutate(!watching, { onError: (e) => toast.error(errorText(e, 'Could not change that')) })
      }
    >
      {watching ? <BellOff /> : <Bell />}
    </Button>
  );
}

// ---- Links ----------------------------------------------------------------------------------------------

export interface LinksHandle {
  startAdding: () => void;
}

export const LinksSection = forwardRef<LinksHandle, { item: WorkItem; onOpenItem?: (key: string) => void }>(
  function LinksSection({ item, onOpenItem }, ref) {
    const links = useLinks(item.id);
    const add = useAddLink(item.id);
    const remove = useRemoveLink(item.id);
    const [adding, setAdding] = useState(false);
    const [linkType, setLinkType] = useState<LinkType>('relates_to');
    const [target, setTarget] = useState<{ id: string; key: string; title: string; type: WorkItem['type'] } | null>(null);
    const [typedKey, setTypedKey] = useState('');
    const canAdd = !!links.data?.permissions.create;
    useImperativeHandle(ref, () => ({ startAdding: () => canAdd && setAdding(true) }));
    const items = links.data?.items ?? [];

    function submit() {
      const ref = target?.id ?? typedKey.trim().toUpperCase();
      if (!ref) return;
      add.mutate(
        { target: ref, linkType },
        {
          onSuccess: () => {
            setAdding(false);
            setTarget(null);
            setTypedKey('');
          },
          onError: (e) => toast.error(errorText(e, 'Could not link those')),
        },
      );
    }

    if (links.isError) return <LoadError what="linked items" onRetry={() => links.refetch()} />;
    if (!links.data || (items.length === 0 && !canAdd)) return null;
    // Group by how the link reads from here ("blocks", "is blocked by", ...).
    const groups = new Map<string, typeof items>();
    for (const l of items) groups.set(l.label, [...(groups.get(l.label) ?? []), l]);

    return (
      <section aria-label="Linked items" className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Linked items</h2>
          {canAdd && !adding && (
            <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => setAdding(true)}>
              <Plus /> Link
            </Button>
          )}
        </div>
        {items.length === 0 && !adding && <p className="text-muted-foreground text-sm">Nothing linked yet.</p>}
        {[...groups.entries()].map(([label, list]) => (
          <div key={label} className="space-y-1">
            <p className="text-muted-foreground text-xs font-medium">{label[0]!.toUpperCase() + label.slice(1)}</p>
            <ul className="divide-y rounded-lg border">
              {list.map((l) => (
                <li key={l.id} className="flex items-center gap-2 px-3 py-1.5">
                  <TypeIcon type={l.item.type} />
                  <button
                    type="button"
                    onClick={() => onOpenItem?.(l.item.key)}
                    className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
                  >
                    <span className="text-muted-foreground mr-2 tabular-nums">{l.item.key}</span>
                    {l.item.title}
                  </button>
                  <StatusChip name={l.item.status.name} category={l.item.status.category} className="hidden sm:inline-flex" />
                  {links.data?.permissions.delete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Remove link to ${l.item.key}`}
                      onClick={() => remove.mutate(l.id, { onError: (e) => toast.error(errorText(e, 'Could not remove it')) })}
                    >
                      <X />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {adding && (
          <form
            className="bg-muted/40 space-y-2 rounded-lg border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
              <Select value={linkType} onValueChange={(v) => setLinkType(v as LinkType)}>
                <SelectTrigger aria-label="Link type" className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LINK_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      This {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ItemPicker
                space={item.spaceKey}
                types={['epic', 'story', 'task', 'bug', 'subtask']}
                value={target}
                excludeId={item.id}
                placeholder="Search this space"
                onChange={(p) => {
                  setTarget(p);
                  if (p) setTypedKey('');
                }}
              />
            </div>
            <Input
              aria-label="Or the key of an item in another space"
              placeholder="Or type a key from another space, for example OPS-12"
              className="h-8"
              value={typedKey}
              onChange={(e) => {
                setTypedKey(e.target.value);
                if (e.target.value) setTarget(null);
              }}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={(!target && !typedKey.trim()) || add.isPending}>
                {add.isPending && <Loader2 className="animate-spin" />} Link
              </Button>
            </div>
          </form>
        )}
      </section>
    );
  },
);

// ---- Attachments ----------------------------------------------------------------------------------------

type Uploading = { id: string; name: string; pct: number };

export interface AttachmentsHandle {
  pick: () => void;
}

export const AttachmentsSection = forwardRef<AttachmentsHandle, { item: WorkItem }>(function AttachmentsSection(
  { item },
  ref,
) {
  const files = useAttachments(item.id);
  const changed = useAttachmentsChanged(item.id);
  const del = useDeleteAttachment(item.id);
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Uploading[]>([]);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const canAdd = !!files.data?.permissions.add;
  useImperativeHandle(ref, () => ({ pick: () => canAdd && input.current?.click() }));

  async function send(list: FileList | File[]) {
    const max = (files.data?.maxFileMb ?? 25) * 1024 * 1024;
    for (const file of Array.from(list)) {
      if (file.size > max) {
        toast.error(`${file.name} is larger than ${files.data?.maxFileMb} MB`);
        continue;
      }
      const id = crypto.randomUUID();
      setUploads((u) => [...u, { id, name: file.name, pct: 0 }]);
      try {
        await uploadAttachment(item.id, file, (pct) =>
          setUploads((u) => u.map((x) => (x.id === id ? { ...x, pct } : x))),
        );
        await changed();
      } catch (e) {
        toast.error(errorText(e, `Could not upload ${file.name}`));
      } finally {
        setUploads((u) => u.filter((x) => x.id !== id));
      }
    }
  }

  if (files.isError) return <LoadError what="attachments" onRetry={() => files.refetch()} />;
  if (!files.data) return null;
  const items = files.data.items;
  if (items.length === 0 && !canAdd) return null;

  return (
    <section
      aria-label="Attachments"
      className={cn('space-y-2 rounded-lg', dragging && 'ring-primary ring-2 ring-offset-4')}
      onDragOver={(e) => {
        if (!canAdd || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!canAdd) return;
        e.preventDefault();
        setDragging(false);
        void send(e.dataTransfer.files);
      }}
    >
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Attachments</h2>
        {items.length > 0 && <span className="text-muted-foreground text-xs">{items.length}</span>}
        {canAdd && (
          <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => input.current?.click()}>
            <Paperclip /> Attach
          </Button>
        )}
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose files to attach"
          onChange={(e) => {
            if (e.target.files?.length) void send(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {items.length === 0 && uploads.length === 0 && (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="text-muted-foreground hover:bg-accent/50 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-sm"
        >
          <Upload className="size-4" aria-hidden /> Drop files here or choose them (up to {files.data.maxFileMb} MB each)
        </button>
      )}
      {(items.length > 0 || uploads.length > 0) && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((a) => (
            <li key={a.id} className="group flex items-center gap-3 rounded-lg border p-2">
              {a.isImage ? (
                <button
                  type="button"
                  onClick={() => setPreview({ url: a.url, name: a.name })}
                  className="bg-muted size-12 shrink-0 overflow-hidden rounded"
                  aria-label={`Preview ${a.name}`}
                >
                  <img src={a.url} alt="" className="size-full object-cover" />
                </button>
              ) : (
                <span className="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded">
                  <FileText className="size-5" aria-hidden />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <a href={a.url} className="block truncate text-sm font-medium hover:underline" download={a.isImage ? undefined : a.name}>
                  {a.name}
                </a>
                <p className="text-muted-foreground truncate text-xs">
                  {sizeText(a.size)} · {nameOf(a.uploader)}
                </p>
              </div>
              {a.permissions.delete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Delete ${a.name}`}
                  onClick={() => {
                    if (window.confirm(`Delete ${a.name}?`)) {
                      del.mutate(a.id, { onError: (e) => toast.error(errorText(e, 'Could not delete it')) });
                    }
                  }}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
          {uploads.map((u) => (
            <li key={u.id} className="flex items-center gap-3 rounded-lg border border-dashed p-2">
              <span className="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded">
                <ImageIcon className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-sm">{u.name}</p>
                <Progress value={u.pct} className="h-1.5" aria-label={`Uploading ${u.name}, ${u.pct}%`} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.name}</DialogTitle>
          </DialogHeader>
          {preview && (
            <img src={preview.url} alt={preview.name} className="max-h-[75vh] w-full rounded object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
});

// ---- Comments, activity, watchers -------------------------------------------------------------------------

export interface ConversationHandle {
  focusComment: () => void;
}

export const Conversation = forwardRef<ConversationHandle, { item: WorkItem; onOpenItem?: (key: string) => void }>(
  function Conversation({ item, onOpenItem }, ref) {
    const [tab, setTab] = useState('comments');
    const composer = useRef<RichTextEditorHandle>(null);
    useImperativeHandle(ref, () => ({
      focusComment: () => {
        setTab('comments');
        setTimeout(() => composer.current?.focus(), 0);
      },
    }));
    return (
      <Tabs value={tab} onValueChange={setTab} className="space-y-3">
        <TabsList aria-label="Conversation and history">
          <TabsTrigger value="comments">Comments</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="watchers">Watchers</TabsTrigger>
        </TabsList>
        <TabsContent value="comments">
          <Comments item={item} composer={composer} />
        </TabsContent>
        <TabsContent value="activity">
          <Activity item={item} onOpenItem={onOpenItem} />
        </TabsContent>
        <TabsContent value="watchers">
          <Watchers itemId={item.id} />
        </TabsContent>
      </Tabs>
    );
  },
);

function Comments({ item, composer }: { item: WorkItem; composer: React.RefObject<RichTextEditorHandle | null> }) {
  const comments = useComments(item.id);
  const add = useAddComment(item.id);
  const [draft, setDraft] = useState<RichDoc | null>(null);
  // A fresh editor after each post is the simplest way to start again from empty.
  const [round, setRound] = useState(0);
  const searchPeople = (q: string) => searchAssignees(item.spaceKey, q);

  function submit() {
    if (!draft || isEmptyDoc(draft)) return;
    add.mutate(draft, {
      onSuccess: () => {
        setDraft(null);
        setRound((n) => n + 1);
      },
      onError: (e) => toast.error(errorText(e, 'Could not post that comment')),
    });
  }

  if (comments.isError) return <LoadError what="comments" onRetry={() => comments.refetch()} />;
  if (!comments.data) return <p className="text-muted-foreground text-sm">Loading…</p>;
  const list = comments.data.items;
  return (
    <div className="space-y-4">
      {list.length === 0 && <p className="text-muted-foreground text-sm">No comments yet.</p>}
      <ol className="space-y-4">
        {list.map((c) => (
          <CommentRow key={c.id} item={item} comment={c} searchPeople={searchPeople} />
        ))}
      </ol>
      {comments.data.permissions.create && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <RichTextEditor
            key={round}
            ref={composer}
            label="Add a comment"
            value={draft}
            onChange={setDraft}
            placeholder="Add a comment… Type @ to mention someone."
            searchPeople={searchPeople}
            onSubmit={submit}
            className="text-sm"
          />
          <div className="flex items-center justify-end gap-2">
            <span className="text-muted-foreground text-xs">Ctrl + Enter to send</span>
            <Button type="submit" size="sm" disabled={isEmptyDoc(draft) || add.isPending}>
              {add.isPending && <Loader2 className="animate-spin" />} Comment
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function CommentRow({
  item,
  comment: c,
  searchPeople,
}: {
  item: WorkItem;
  comment: Comment;
  searchPeople: (q: string) => Promise<import('@/lib/work').Person[]>;
}) {
  const edit = useEditComment(item.id);
  const del = useDeleteComment(item.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RichDoc | null>(c.body);
  return (
    <li className="flex gap-3">
      <UserAvatar person={c.author} size={28} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs">
          <span className="font-semibold">{nameOf(c.author)}</span>{' '}
          <time dateTime={c.createdAt} className="text-muted-foreground">
            {when(c.createdAt)}
          </time>
          {c.editedAt && !c.deleted && <span className="text-muted-foreground"> · edited</span>}
        </p>
        {c.deleted ? (
          <p className="text-muted-foreground text-sm italic">This comment was deleted.</p>
        ) : editing ? (
          <div className="space-y-2">
            <RichTextEditor
              label="Edit comment"
              value={draft}
              onChange={setDraft}
              searchPeople={searchPeople}
              autoFocus
              className="text-sm"
              onSubmit={() => draft && edit.mutate({ id: c.id, body: draft }, { onSuccess: () => setEditing(false) })}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={isEmptyDoc(draft) || edit.isPending}
                onClick={() =>
                  draft &&
                  edit.mutate(
                    { id: c.id, body: draft },
                    {
                      onSuccess: () => setEditing(false),
                      onError: (e) => toast.error(errorText(e, 'Could not save the comment')),
                    },
                  )
                }
              >
                <Check /> Save
              </Button>
            </div>
          </div>
        ) : (
          <RichTextView doc={c.body} className="text-sm" />
        )}
        {!c.deleted && !editing && (c.permissions.edit || c.permissions.delete) && (
          <div className="flex gap-1">
            {c.permissions.edit && (
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => setEditing(true)}>
                <Pencil className="size-3" /> Edit
              </Button>
            )}
            {c.permissions.delete && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs"
                onClick={() => {
                  if (window.confirm('Delete this comment?')) {
                    del.mutate(c.id, { onError: (e) => toast.error(errorText(e, 'Could not delete it')) });
                  }
                }}
              >
                <Trash2 className="size-3" /> Delete
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

const FIELD_NAMES: Record<string, string> = {
  title: 'the title',
  description: 'the description',
  type: 'the type',
  status: 'the status',
  priority: 'the priority',
  assignee: 'the assignee',
  parent: 'the parent',
  estimate: 'the estimate',
  dueDate: 'the due date',
  labels: 'the labels',
};

function show(field: string | null, v: unknown, typeLabel: (t: WorkItem['type']) => string): string {
  if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) return 'none';
  if (field === 'type') return typeLabel(v as WorkItem['type']);
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') {
    const o = v as { name?: string; key?: string; title?: string };
    return o.name ?? (o.key ? `${o.key} ${o.title ?? ''}`.trim() : '');
  }
  return String(v);
}

/** One line of history, in plain words. */
function describe(e: ActivityEvent, noun: string, typeLabel: (t: WorkItem['type']) => string): React.ReactNode {
  const v = (x: unknown) => <strong className="font-medium">{show(e.field, x, typeLabel)}</strong>;
  switch (e.kind) {
    case 'created':
      return `created this ${noun}`;
    case 'deleted':
      return `deleted this ${noun}`;
    case 'moved':
      return <>moved this from {v(e.oldValue)} to {v(e.newValue)}</>;
    case 'updated':
      if (e.field === 'description') return 'updated the description';
      if (e.field === 'assignee') return e.newValue ? <>assigned this to {v(e.newValue)}</> : 'removed the assignee';
      return (
        <>
          changed {FIELD_NAMES[e.field ?? ''] ?? e.field} from {v(e.oldValue)} to {v(e.newValue)}
        </>
      );
    case 'commented':
      return <>commented: “{e.newValue?.excerpt}”</>;
    case 'comment_deleted':
      return 'deleted a comment';
    case 'linked':
      return (
        <>
          linked: this {e.newValue?.label} <strong className="font-medium">{e.newValue?.key}</strong>
        </>
      );
    case 'unlinked':
      return <>removed a link (this {e.oldValue?.label})</>;
    case 'attachment_added':
      return <>attached <strong className="font-medium">{e.newValue?.name}</strong></>;
    case 'attachment_removed':
      return <>removed the attachment <strong className="font-medium">{e.oldValue?.name}</strong></>;
    case 'transferred':
      return (
        <>
          moved this from {e.oldValue?.spaceKey} to {e.newValue?.spaceKey}
          {e.oldValue?.key ? ` (it was ${e.oldValue.key})` : ''}
        </>
      );
    case 'duplicated':
      return e.newValue?.from ? (
        <>created this as a copy of <strong className="font-medium">{e.newValue.from.key}</strong></>
      ) : (
        <>copied this to <strong className="font-medium">{e.newValue?.to?.key}</strong></>
      );
  }
}

function Activity({ item, onOpenItem: _onOpenItem }: { item: WorkItem; onOpenItem?: (key: string) => void }) {
  const vocab = useVocabulary();
  const activity = useActivity(item.id);
  if (activity.isError) return <LoadError what="the activity" onRetry={() => activity.refetch()} />;
  if (!activity.data) return <p className="text-muted-foreground text-sm">Loading…</p>;
  const events = activity.data.pages.flatMap((p) => p.items);
  return (
    <div className="space-y-3">
      <ol className="space-y-3" aria-label="History, newest first">
        {events.map((e) => (
          <li key={e.id} className="flex gap-3 text-sm">
            <UserAvatar person={e.actor} size={24} />
            <p className="min-w-0 flex-1">
              <span className="font-semibold">{nameOf(e.actor)}</span> {describe(e, vocab.noun, vocab.typeLabel)}
              <time dateTime={e.createdAt} className="text-muted-foreground block text-xs">
                {when(e.createdAt)}
              </time>
            </p>
          </li>
        ))}
      </ol>
      {activity.hasNextPage && (
        <Button variant="outline" size="sm" disabled={activity.isFetchingNextPage} onClick={() => activity.fetchNextPage()}>
          {activity.isFetchingNextPage && <Loader2 className="animate-spin" />} Show older
        </Button>
      )}
    </div>
  );
}

function Watchers({ itemId }: { itemId: string }) {
  const watchers = useWatchers(itemId);
  const toggle = useToggleWatch(itemId);
  if (watchers.isError) return <LoadError what="watchers" onRetry={() => watchers.refetch()} />;
  if (!watchers.data) return <p className="text-muted-foreground text-sm">Loading…</p>;
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Watchers follow this item. The reporter, the assignee, commenters and anyone mentioned watch it automatically.
      </p>
      <ul className="space-y-2">
        {watchers.data.items.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-sm">
            <UserAvatar person={p} size={24} />
            <span className="truncate">{nameOf(p)}</span>
          </li>
        ))}
      </ul>
      <Button variant="outline" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate(!watchers.data!.watching)}>
        {watchers.data.watching ? (
          <>
            <BellOff /> Stop watching
          </>
        ) : (
          <>
            <Bell /> Watch
          </>
        )}
      </Button>
    </div>
  );
}

// ---- Duplicate and move dialogs -----------------------------------------------------------------------------

export function DuplicateDialog({
  item,
  open,
  onOpenChange,
  onDone,
}: {
  item: WorkItem;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: (key: string) => void;
}) {
  const vocab = useVocabulary();
  const dup = useDuplicateItem();
  const [withSubtasks, setWithSubtasks] = useState(true);
  const hasKids = item.type !== 'epic' && item.subtasks.total > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate {item.key}?</DialogTitle>
          <DialogDescription>
            A new {vocab.noun} with the same details is created in this space. You become its reporter.
          </DialogDescription>
        </DialogHeader>
        {hasKids && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={withSubtasks} onCheckedChange={(v) => setWithSubtasks(v === true)} />
            Copy its {item.subtasks.total} subtask{item.subtasks.total === 1 ? '' : 's'} too
          </label>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={dup.isPending}
            onClick={() =>
              dup.mutate(
                { item, includeSubtasks: withSubtasks },
                {
                  onSuccess: (copy) => {
                    toast.success(`${copy.key} created`);
                    onOpenChange(false);
                    onDone(copy.key);
                  },
                  onError: (e) => toast.error(errorText(e, 'Could not duplicate it')),
                },
              )
            }
          >
            {dup.isPending && <Loader2 className="animate-spin" />} Duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TransferDialog({
  item,
  open,
  onOpenChange,
  onDone,
}: {
  item: WorkItem;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: (key: string) => void;
}) {
  const vocab = useVocabulary();
  const { orgRole } = useMe();
  const transfer = useTransferItem();
  const [spaceId, setSpaceId] = useState('');
  const spaces = useQuery({
    queryKey: ['spaces', 'transfer-targets'],
    queryFn: () => api<Page<Space>>(`/spaces${qs({ pageSize: 100 })}`),
    enabled: open,
  });
  // Spaces the person can add work to (the server checks again).
  const targets = (spaces.data?.items ?? []).filter(
    (s) =>
      s.id !== item.spaceId &&
      s.status === 'active' &&
      (orgRole !== 'member' || s.myRole === 'admin' || s.myRole === 'member'),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move {item.key} to another space</DialogTitle>
          <DialogDescription>
            It gets a new key there. {item.type !== 'epic' && item.subtasks.total > 0 ? 'Its subtasks move with it. ' : ''}
            Comments, attachments, links and history stay with the {vocab.noun}. Columns are matched by name, and labels
            that do not exist in the new space are dropped.
          </DialogDescription>
        </DialogHeader>
        <Select value={spaceId} onValueChange={setSpaceId}>
          <SelectTrigger aria-label="Space to move to">
            <SelectValue placeholder={spaces.isPending ? 'Loading spaces…' : 'Choose a space'} />
          </SelectTrigger>
          <SelectContent>
            {targets.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} ({s.key})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!spaceId || transfer.isPending}
            onClick={() =>
              transfer.mutate(
                { item, spaceId },
                {
                  onSuccess: (moved) => {
                    toast.success(`Moved. ${moved.previousKey} is now ${moved.key}`);
                    onOpenChange(false);
                    onDone(moved.key);
                  },
                  onError: (e) => toast.error(errorText(e, 'Could not move it')),
                },
              )
            }
          >
            {transfer.isPending && <Loader2 className="animate-spin" />} Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
