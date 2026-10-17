'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  Check,
  Copy,
  CopyPlus,
  ExternalLink,
  Link2,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
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
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadError } from '@/components/shared/load-error';
import { ApiError } from '@/lib/api';
import {
  toastError,
  itemKey,
  useCreateItem,
  useDeleteItem,
  useItem,
  useStatuses,
  useSubtasks,
  useUpdateItem,
  type ItemPatch,
} from '@/lib/work-api';
import { TimeSection } from './time-section';
import { ComponentPicker, VersionPicker } from './version-bits';
import { BlockedMoveDialog, BlockedNotice, ChecklistSection, movesBlockedForward, ResolutionField } from './item-extras';
import { SlaDetail } from './sla-badge';
import { TYPE_META, type ItemType, type Person, type WorkItem } from '@/lib/work';
import { cn } from '@/lib/utils';
import { ItemPanelSkeleton } from './board-bits';
import { LabelPicker } from './label-bits';
import { StatusChip, TypeIcon, UserAvatar } from './work-bits';
import {
  AssigneePicker,
  ItemPicker,
  PrioritySelect,
  STORY_POINTS,
  StatusSelect,
} from './work-pickers';
import { useVocabulary } from './use-vocabulary';
import {
  AttachmentsSection,
  Conversation,
  DescriptionEditor,
  DuplicateDialog,
  LinksSection,
  TransferDialog,
  WatchButton,
  type AttachmentsHandle,
  type ConversationHandle,
  type LinksHandle,
} from './item-depth';

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-muted-foreground block text-xs font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Grows with its text so a long title or description never needs an inner scrollbar. */
function AutoText({
  value,
  onChange,
  onCommit,
  readOnly,
  className,
  placeholder,
  label,
  singleLine,
  maxLength,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
  label: string;
  singleLine?: boolean;
  maxLength?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      aria-label={label}
      rows={1}
      value={value}
      readOnly={readOnly}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => onChange(singleLine ? e.target.value.replace(/\n/g, ' ') : e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (singleLine && e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') e.currentTarget.blur();
      }}
      className={cn(
        'placeholder:text-muted-foreground block w-full resize-none rounded-md border border-transparent bg-transparent px-2 py-1 -mx-2 outline-none',
        !readOnly && 'hover:border-input focus:border-ring focus:bg-background focus:ring-ring/30 focus:ring-2',
        className,
      )}
    />
  );
}

export function ItemDetail({
  itemRef,
  variant,
  onClose,
  onOpenItem,
}: {
  itemRef: string;
  variant: 'panel' | 'page';
  onClose?: () => void;
  onOpenItem?: (key: string) => void;
}) {
  const vocab = useVocabulary();
  const qc = useQueryClient();
  const query = useItem(itemRef);
  const item = query.data;
  const statuses = useStatuses(item?.spaceKey ?? '');
  const update = useUpdateItem();
  const del = useDeleteItem();
  const [title, setTitle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [blockedMove, setBlockedMove] = useState<{ run: () => void } | null>(null);
  const [dialog, setDialog] = useState<'duplicate' | 'transfer' | null>(null);
  const conversation = useRef<ConversationHandle>(null);
  const links = useRef<LinksHandle>(null);
  const attachments = useRef<AttachmentsHandle>(null);
  const root = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<'link' | 'key' | null>(null);

  // Keep the drafts in step with the server whenever the item changes underneath us (not while typing).
  const serverVersion = item ? `${item.id}:${item.updatedAt}` : '';
  useEffect(() => {
    if (!item) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLTextAreaElement && active.closest('[data-item-detail]'))) {
      setTitle(item.title);
    }
  }, [serverVersion]);

  // Panel shortcuts: M comment, A assignee, L labels (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (!root.current || (el && el !== document.body && !root.current.contains(el))) return;
      const key = e.key.toLowerCase();
      if (key === 'm') {
        e.preventDefault();
        conversation.current?.focusComment();
      } else if (key === 'a' || key === 'l' || key === 't' || key === 'd' || key === 'v') {
        const id = { a: '#f-assignee', l: '#f-labels', t: '#f-status', d: '#f-due', v: '#f-fixversion' }[key];
        const target = root.current.querySelector<HTMLElement>(id);
        if (target && !target.hasAttribute('disabled')) {
          e.preventDefault();
          target.click();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const dirty = !!item && title.trim() !== item.title;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (query.isPending) return <ItemPanelSkeleton />;
  if (query.isError || !item) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return missing ? (
      <EmptyState
        title={`${vocab.Noun} not found`}
        description="It may have been deleted, or you may not have access to its space."
        action={
          onClose ? (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          ) : undefined
        }
      />
    ) : (
      <LoadError what={`this ${vocab.noun}`} onRetry={() => query.refetch()} />
    );
  }

  const canEdit = !!item.permissions?.edit;
  const canDelete = !!item.permissions?.delete;
  const list = statuses.data?.items ?? [];
  const firstOf = (c: 'todo' | 'done') => list.find((s) => s.category === c);
  const base = `/spaces/${item.spaceKey}`;
  const pageHref = `${base}/items/${item.key}`;

  function save(patch: ItemPatch, optimistic: Partial<WorkItem> = {}) {
    update.mutate({ item: item!, patch, optimistic });
  }
  function commitTitle() {
    const t = title.trim();
    if (!t) {
      setTitle(item!.title);
      return;
    }
    if (t !== item!.title) save({ title: t }, { title: t });
  }
  const openKey = (key: string) => {
    if (onOpenItem) onOpenItem(key);
    else window.location.assign(`/spaces/${key.split('-')[0]}/items/${key}`);
  };
  async function copy(what: 'link' | 'key') {
    try {
      await navigator.clipboard.writeText(
        what === 'link' ? `${window.location.origin}${pageHref}` : item!.key,
      );
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error('Could not copy');
    }
  }

  const saveState = update.isPending ? 'saving' : update.isError ? 'error' : update.isSuccess ? 'saved' : 'idle';
  const childLabel = item.type === 'epic' ? 'Stories in this epic' : 'Subtasks';
  const showChildren = item.type !== 'subtask';
  const done = item.status.category === 'done';

  return (
    <div ref={root} data-item-detail className={cn('space-y-6', variant === 'panel' ? 'p-6' : 'py-2')}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={!canEdit}>
            <button
              type="button"
              className="focus-visible:ring-ring rounded-sm p-0.5 outline-none focus-visible:ring-2 disabled:cursor-default"
              aria-label={`Type: ${vocab.typeLabel(item.type)}${canEdit ? '. Change type' : ''}`}
            >
              <TypeIcon type={item.type} size="md" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {(Object.keys(TYPE_META) as ItemType[])
              // A ticket keeps its type, and nothing else becomes one.
              .filter((t) => (item.type === 'ticket' ? t === 'ticket' : t !== 'ticket' && (vocab.allowedTypes.includes(t) || t === item.type)))
              .map((t) => (
              <DropdownMenuItem
                key={t}
                onSelect={() => t !== item.type && save({ type: t }, { type: t })}
              >
                <TypeIcon type={t} /> {vocab.typeLabel(t)}
                {t === item.type && <Check className="ml-auto size-4" aria-hidden />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <nav aria-label="Breadcrumb" className="text-muted-foreground flex min-w-0 items-center gap-1 text-sm">
          <Link href={base} className="hover:text-foreground font-medium">
            {item.spaceKey}
          </Link>
          {item.parent && (
            <>
              <span aria-hidden>/</span>
              <button
                type="button"
                onClick={() => onOpenItem?.(item.parent!.key)}
                className="hover:text-foreground max-w-40 truncate"
                title={item.parent.title}
              >
                {item.parent.key}
              </button>
            </>
          )}
          <span aria-hidden>/</span>
          <span className="text-foreground font-medium tabular-nums">{item.key}</span>
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <span
            aria-live="polite"
            className={cn(
              'text-muted-foreground mr-1 inline-flex items-center gap-1 text-xs',
              saveState === 'error' && 'text-destructive',
            )}
          >
            {saveState === 'saving' && (
              <>
                <Loader2 className="size-3 animate-spin" aria-hidden /> Saving…
              </>
            )}
            {saveState === 'saved' && (
              <>
                <Check className="size-3" aria-hidden /> Saved
              </>
            )}
            {saveState === 'error' && 'Not saved'}
          </span>
          <WatchButton itemId={item.id} />
          <Button variant="ghost" size="icon" className="size-8" onClick={() => copy('link')} aria-label="Copy link">
            {copied === 'link' ? <Check /> : <Link2 />}
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={() => copy('key')} aria-label="Copy key">
            {copied === 'key' ? <Check /> : <Copy />}
          </Button>
          {variant === 'panel' && (
            <Button variant="ghost" size="icon" className="size-8" asChild>
              <Link href={pageHref} aria-label="Open as a full page">
                <ExternalLink />
              </Link>
            </Button>
          )}
          {(canEdit || canDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit && (
                  <>
                    <DropdownMenuItem onSelect={() => attachments.current?.pick()}>
                      <Paperclip /> Attach files
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => links.current?.startAdding()}>
                      <Link2 /> Link {vocab.noun}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setDialog('duplicate')}>
                      <CopyPlus /> Duplicate
                    </DropdownMenuItem>
                  </>
                )}
                {canDelete && (
                  <>
                    {item.type !== 'subtask' && (
                      <DropdownMenuItem onSelect={() => setDialog('transfer')}>
                        <ArrowRightLeft /> Move to another space
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {variant === 'panel' && onClose && (
            <Button variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label="Close">
              <X />
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_16.5rem]">
        {/* Main column */}
        <div className="min-w-0 space-y-7">
          <AutoText
            label="Title"
            singleLine
            maxLength={255}
            value={title}
            onChange={setTitle}
            onCommit={commitTitle}
            readOnly={!canEdit}
            className="text-xl font-semibold tracking-tight"
          />

          <BlockedNotice item={item} />

          <section aria-label="Description" className="space-y-2">
            <h2 className="text-sm font-semibold">Description</h2>
            <DescriptionEditor
              key={item.id}
              item={item}
              canEdit={canEdit}
              onSave={(doc) => save({ descriptionDoc: doc })}
            />
          </section>

          <ChecklistSection item={item} canEdit={canEdit} onChange={(next) => save({ checklist: next })} />

          <TimeSection item={item} canEdit={canEdit} onSave={(patch) => save(patch)} />

          {showChildren && (
            <ChildrenSection
              parent={item}
              label={childLabel}
              canEdit={canEdit}
              onOpenItem={onOpenItem}
              doneStatusId={firstOf('done')?.id}
              todoStatusId={firstOf('todo')?.id}
            />
          )}

          <LinksSection ref={links} item={item} onOpenItem={openKey} />
          <AttachmentsSection ref={attachments} item={item} />
          <Conversation ref={conversation} item={item} onOpenItem={openKey} />
        </div>

        {/* Fields column */}
        <aside aria-label="Details" className="space-y-4">
          <Field label="Status" htmlFor="f-status">
            {list.length ? (
              <StatusSelect
                id="f-status"
                statuses={list}
                value={item.statusId}
                disabled={!canEdit}
                onChange={(id) => {
                  const s = list.find((x) => x.id === id)!;
                  if (item.subtasks.total - item.subtasks.done > 0 && s.category === 'done') {
                    toast.message(
                      `${item.subtasks.total - item.subtasks.done} subtasks are still open. They were not changed.`,
                    );
                  }
                  const run = () =>
                    save(
                      { statusId: id },
                      {
                        statusId: id,
                        status: { id, name: s.name, category: s.category, color: s.color },
                      },
                    );
                  if (movesBlockedForward(item, s.category)) setBlockedMove({ run });
                  else run();
                }}
              />
            ) : (
              <StatusChip name={item.status.name} category={item.status.category} color={item.status.color} />
            )}
          </Field>

          <ResolutionField item={item} disabled={!canEdit} onChange={(resolution) => save({ resolution }, { resolution })} />

          <Field label="Assignee" htmlFor="f-assignee">
            <AssigneePicker
              id="f-assignee"
              space={item.spaceKey}
              value={item.assignee}
              disabled={!canEdit}
              onChange={(p: Person | null) =>
                save({ assigneeId: p?.id ?? null }, { assignee: p })
              }
            />
          </Field>

          <Field label="Priority" htmlFor="f-priority">
            <PrioritySelect
              id="f-priority"
              value={item.priority}
              disabled={!canEdit}
              onChange={(priority) => save({ priority }, { priority })}
            />
          </Field>

          {item.sla && (
            <div className="space-y-1.5">
              <p className="text-muted-foreground text-xs font-medium">Deadlines</p>
              <SlaDetail sla={item.sla} />
            </div>
          )}

          <Field label="Estimate (story points)" htmlFor="f-estimate">
            <EstimateField
              value={item.estimate}
              disabled={!canEdit}
              onChange={(estimate) => save({ estimate }, { estimate })}
            />
          </Field>

          <Field label="Start date" htmlFor="f-start">
            <Input
              id="f-start"
              type="date"
              className="h-8"
              disabled={!canEdit}
              value={item.startDate ?? ''}
              max={item.dueDate ?? undefined}
              onChange={(e) => {
                const startDate = e.target.value || null;
                if (startDate !== (item.startDate ?? null)) save({ startDate }, { startDate });
              }}
            />
          </Field>

          <Field label="Due date" htmlFor="f-due">
            <Input
              id="f-due"
              type="date"
              className="h-8"
              disabled={!canEdit}
              value={item.dueDate ?? ''}
              onChange={(e) => {
                const dueDate = e.target.value || null;
                if (dueDate !== item.dueDate) save({ dueDate }, { dueDate });
              }}
            />
          </Field>

          <Field label="Labels" htmlFor="f-labels">
            <LabelPicker
              id="f-labels"
              space={item.spaceKey}
              value={item.labels}
              disabled={!canEdit}
              onChange={(next) =>
                save({ labelIds: next.map((l) => l.id) }, { labels: next })
              }
            />
          </Field>

          <Field label="Fix version" htmlFor="f-fixversion">
            <VersionPicker
              id="f-fixversion"
              space={item.spaceKey}
              label="Fix version"
              value={item.fixVersions ?? []}
              disabled={!canEdit}
              onChange={(ids) => save({ fixVersionIds: ids })}
            />
          </Field>

          {item.type === 'bug' && (
            <Field label="Affects version" htmlFor="f-affects">
              <VersionPicker
                id="f-affects"
                space={item.spaceKey}
                label="Affects version"
                value={item.affectsVersions ?? []}
                disabled={!canEdit}
                onChange={(ids) => save({ affectsVersionIds: ids })}
              />
            </Field>
          )}

          <Field label="Components" htmlFor="f-components">
            <ComponentPicker
              id="f-components"
              space={item.spaceKey}
              value={item.components ?? []}
              disabled={!canEdit}
              onChange={(ids) => save({ componentIds: ids })}
            />
          </Field>

          {item.type !== 'epic' && (
            <Field label={item.type === 'subtask' ? 'Parent' : 'Epic'} htmlFor="f-parent">
              <ItemPicker
                id="f-parent"
                space={item.spaceKey}
                types={item.type === 'subtask' ? ['story', 'task', 'bug'] : ['epic']}
                value={item.parent}
                disabled={!canEdit}
                excludeId={item.id}
                placeholder={item.type === 'subtask' ? 'Choose a parent' : 'No epic'}
                onChange={(p) =>
                  p === null && item.type === 'subtask'
                    ? toast.error('A subtask needs a parent')
                    : save(
                        { parentId: p?.id ?? null },
                        { parentId: p?.id ?? null, parent: p },
                      )
                }
              />
            </Field>
          )}

          <div className="border-t pt-4">
            <Field label="Reporter">
              <div className="flex items-center gap-2 text-sm">
                <UserAvatar person={item.reporter} size={20} />
                <span className="truncate">{item.reporter.name ?? item.reporter.email}</span>
              </div>
            </Field>
          </div>
          <dl className="text-muted-foreground space-y-1 text-xs">
            <div className="flex justify-between gap-2">
              <dt>Created</dt>
              <dd className="text-right">{dateTime(item.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Updated</dt>
              <dd className="text-right">{dateTime(item.updatedAt)}</dd>
            </div>
            {item.resolvedAt && (
              <div className="flex justify-between gap-2">
                <dt>Resolved</dt>
                <dd className="text-right">{dateTime(item.resolvedAt)}</dd>
              </div>
            )}
          </dl>
          {!canEdit && (
            <p className="text-muted-foreground bg-muted rounded-md p-2 text-xs">
              You can view this {vocab.noun} but not change it.
            </p>
          )}
          {done && <span className="sr-only">This item is done.</span>}
        </aside>
      </div>

      <DuplicateDialog
        item={item}
        open={dialog === 'duplicate'}
        onOpenChange={(o) => setDialog(o ? 'duplicate' : null)}
        onDone={openKey}
      />
      <TransferDialog
        item={item}
        open={dialog === 'transfer'}
        onOpenChange={(o) => setDialog(o ? 'transfer' : null)}
        onDone={openKey}
      />
      <BlockedMoveDialog
        item={blockedMove ? item : null}
        onConfirm={() => {
          blockedMove?.run();
          setBlockedMove(null);
        }}
        onCancel={() => setBlockedMove(null)}
      />
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {item.key}?</AlertDialogTitle>
            <AlertDialogDescription>
              “{item.title}” will be removed from the board and from search.
              {item.type !== 'epic' && item.subtasks.total > 0
                ? ` Its ${item.subtasks.total} subtask${item.subtasks.total === 1 ? '' : 's'} will be removed too.`
                : ''}
              {item.type === 'epic' && item.subtasks.total > 0
                ? ` The ${item.subtasks.total} stories in it are kept and simply lose their epic.`
                : ''}{' '}
              The history is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                del.mutate(item, {
                  onSuccess: () => {
                    toast.success(`${item.key} deleted`);
                    qc.removeQueries({ queryKey: itemKey(item.key) });
                    if (onClose) onClose();
                    else window.location.assign(base + '/board');
                  },
                })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EstimateField({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  useEffect(() => setDraft(value === null ? '' : String(value)), [value]);
  function commit() {
    const n = draft.trim() === '' ? null : Number(draft);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 999.9)) {
      setDraft(value === null ? '' : String(value));
      toast.error('Enter a number between 0 and 999.9');
      return;
    }
    if (n !== value) onChange(n);
  }
  return (
    <div className="space-y-1.5">
      <Input
        id="f-estimate"
        inputMode="decimal"
        className="h-8"
        placeholder="None"
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {!disabled && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Common story points">
          {STORY_POINTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              aria-pressed={value === p}
              className={cn(
                'hover:bg-accent h-6 min-w-6 rounded-full border px-1.5 text-xs font-semibold tabular-nums',
                value === p && 'bg-primary text-primary-foreground hover:bg-primary border-transparent',
              )}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChildrenSection({
  parent,
  label,
  canEdit,
  onOpenItem,
  doneStatusId,
  todoStatusId,
}: {
  parent: WorkItem;
  label: string;
  canEdit: boolean;
  onOpenItem?: (key: string) => void;
  doneStatusId?: string;
  todoStatusId?: string;
}) {
  const children = useSubtasks(parent.key);
  const create = useCreateItem(parent.spaceKey);
  const update = useUpdateItem();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const items = children.data?.items ?? [];
  const done = items.filter((i) => i.status.category === 'done').length;
  const pct = useMemo(() => (items.length ? Math.round((done / items.length) * 100) : 0), [done, items.length]);
  const childType: ItemType = parent.type === 'epic' ? 'story' : 'subtask';

  async function add() {
    const t = title.trim();
    if (!t) return;
    setTitle('');
    try {
      await create.mutateAsync({ type: childType, title: t, parentId: parent.id });
      void children.refetch();
    } catch (e) {
      setTitle(t);
      toastError(e, 'Could not add that');
    }
  }

  return (
    <section aria-label={label} className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">{label}</h2>
        {items.length > 0 && (
          <>
            <Progress value={pct} className="h-1.5 max-w-40 flex-1" aria-label={`${done} of ${items.length} done`} />
            <span className="text-muted-foreground text-xs tabular-nums">
              {done} of {items.length}
            </span>
          </>
        )}
        {canEdit && !adding && (
          <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => setAdding(true)}>
            <Plus /> Add
          </Button>
        )}
      </div>

      {children.isPending && <p className="text-muted-foreground text-sm">Loading…</p>}
      {children.isError && <LoadError what={label.toLowerCase()} onRetry={() => children.refetch()} />}
      {children.isSuccess && items.length === 0 && !adding && (
        <p className="text-muted-foreground text-sm">
          {parent.type === 'epic' ? 'No stories yet.' : 'No subtasks yet. Break the work into steps.'}
        </p>
      )}
      <ul className="divide-y rounded-lg border">
        {items.map((c) => {
          const isDone = c.status.category === 'done';
          return (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2">
              {canEdit && (doneStatusId || todoStatusId) ? (
                <input
                  type="checkbox"
                  className="accent-primary size-4"
                  checked={isDone}
                  aria-label={`${c.key} ${isDone ? 'mark as not done' : 'mark as done'}`}
                  onChange={() => {
                    const id = isDone ? todoStatusId : doneStatusId;
                    if (id) update.mutate({ item: c, patch: { statusId: id } });
                  }}
                />
              ) : null}
              <TypeIcon type={c.type} />
              <button
                type="button"
                onClick={() => onOpenItem?.(c.key)}
                className={cn('min-w-0 flex-1 truncate text-left text-sm hover:underline', isDone && 'text-muted-foreground line-through')}
              >
                {c.title}
              </button>
              <StatusChip name={c.status.name} category={c.status.category} className="hidden sm:inline-flex" />
              <UserAvatar person={c.assignee} size={20} />
            </li>
          );
        })}
      </ul>
      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
          className="flex gap-2"
        >
          <Input
            autoFocus
            aria-label={parent.type === 'epic' ? 'Story title' : 'Subtask title'}
            placeholder={parent.type === 'epic' ? 'What is the story?' : 'What is the next step?'}
            value={title}
            maxLength={255}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setAdding(false);
                setTitle('');
              }
            }}
          />
          <Button type="submit" disabled={!title.trim() || create.isPending}>
            Add
          </Button>
        </form>
      )}
    </section>
  );
}
