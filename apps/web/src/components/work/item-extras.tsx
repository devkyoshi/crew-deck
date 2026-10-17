'use client';

import { useState } from 'react';
import { Ban, ListChecks, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RESOLUTION_LABEL, type ChecklistEntry, type Resolution, type WorkItem } from '@/lib/work';
import { useChecklistTemplates } from '@/lib/workflow-api';
import { cn } from '@/lib/utils';

const MAX_ENTRIES = 50;

/** Why a finished item was finished. Only shown while the item is in a Done status. */
export function ResolutionField({
  item,
  disabled,
  onChange,
}: {
  item: WorkItem;
  disabled: boolean;
  onChange: (resolution: Resolution) => void;
}) {
  if (item.status.category !== 'done') return null;
  return (
    <div className="space-y-1.5">
      <label htmlFor="f-resolution" className="text-muted-foreground block text-xs font-medium">
        Resolution
      </label>
      <Select value={item.resolution ?? 'done'} disabled={disabled} onValueChange={(v) => onChange(v as Resolution)}>
        <SelectTrigger id="f-resolution" className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(RESOLUTION_LABEL) as Resolution[]).map((r) => (
            <SelectItem key={r} value={r}>
              {RESOLUTION_LABEL[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** A plain-words banner when open items still block this one. */
export function BlockedNotice({ item }: { item: WorkItem }) {
  const n = item.blockedBy ?? 0;
  if (n === 0 || item.status.category === 'done') return null;
  return (
    <p
      role="note"
      className="flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger-soft-foreground "
    >
      <Ban className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        Blocked by {n} open {n === 1 ? 'item' : 'items'}. See Linked items below.
      </span>
    </p>
  );
}

/** Asks before a blocked item moves on. It only warns: the move still goes ahead when confirmed. */
export function BlockedMoveDialog({
  item,
  onConfirm,
  onCancel,
}: {
  item: WorkItem | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={!!item} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{item?.key} is still blocked</AlertDialogTitle>
          <AlertDialogDescription>
            {item?.blockedBy} open {item?.blockedBy === 1 ? 'item blocks' : 'items block'} it. Move it anyway?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it where it is</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Move anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** True when moving into `category` is a step forward for an item that something open still blocks. */
export const movesBlockedForward = (item: WorkItem, category: WorkItem['status']['category']) =>
  (item.blockedBy ?? 0) > 0 && category !== 'todo' && item.status.category === 'todo';

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** The item's own to-do list, with progress. Changes save as a whole list. */
export function ChecklistSection({
  item,
  canEdit,
  onChange,
}: {
  item: WorkItem;
  canEdit: boolean;
  onChange: (next: ChecklistEntry[]) => void;
}) {
  const entries = item.checklist?.items ?? [];
  const [text, setText] = useState('');
  const templates = useChecklistTemplates(item.spaceKey, canEdit);
  const done = entries.filter((e) => e.done).length;
  const add = (texts: string[]) => {
    const room = MAX_ENTRIES - entries.length;
    const fresh = texts.slice(0, room).map((t) => ({ id: newId(), text: t, done: false }));
    if (fresh.length) onChange([...entries, ...fresh]);
  };
  if (!canEdit && entries.length === 0) return null;
  return (
    <section aria-label="Checklist" className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Checklist</h2>
        {entries.length > 0 && (
          <span className="text-muted-foreground text-xs tabular-nums">
            {done}/{entries.length}
          </span>
        )}
        {canEdit && (templates.data?.items.length ?? 0) > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs">
                <ListChecks /> From a template
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Add the entries of</DropdownMenuLabel>
              {templates.data!.items.map((tpl) => (
                <DropdownMenuItem key={tpl.id} onSelect={() => add(tpl.items)}>
                  {tpl.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {entries.length > 0 && (
        <Progress value={(done / entries.length) * 100} aria-label="Checklist progress" className="h-1.5" />
      )}
      <ul className="space-y-1">
        {entries.map((e) => (
          <li key={e.id} className="group flex items-center gap-2 text-sm">
            <Checkbox
              aria-label={e.text}
              checked={e.done}
              disabled={!canEdit}
              onCheckedChange={(v) => onChange(entries.map((x) => (x.id === e.id ? { ...x, done: v === true } : x)))}
            />
            <span className={cn('min-w-0 flex-1 break-words', e.done && 'text-muted-foreground line-through')}>
              {e.text}
            </span>
            {canEdit && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                aria-label={`Remove ${e.text}`}
                onClick={() => onChange(entries.filter((x) => x.id !== e.id))}
              >
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && entries.length < MAX_ENTRIES && (
        <form
          className="flex gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            const t = text.trim();
            if (!t) return;
            add([t.slice(0, 200)]);
            setText('');
          }}
        >
          <Input
            aria-label="New checklist entry"
            placeholder="Add an entry…"
            value={text}
            maxLength={200}
            onChange={(ev) => setText(ev.target.value)}
            className="h-8"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!text.trim()}>
            <Plus /> Add
          </Button>
        </form>
      )}
    </section>
  );
}
