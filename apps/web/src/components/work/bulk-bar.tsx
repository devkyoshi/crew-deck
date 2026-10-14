'use client';

import { useState } from 'react';
import { Tag, Trash2, X } from 'lucide-react';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useBulk, useLabels, errorText, type BulkBody } from '@/lib/work-api';
import type { BoardData, Person } from '@/lib/work';
import { LabelChip } from './label-bits';
import { AssigneePicker } from './work-pickers';

/**
 * Appears at the foot of the board while cards are selected (Ctrl or Cmd-click, or "Select" in a card
 * menu). Every action reports how many cards it changed and which ones it could not.
 */
export function BulkBar({
  space,
  ids,
  statuses,
  canDelete,
  onClear,
}: {
  space: string;
  ids: string[];
  statuses: BoardData['statuses'];
  /** Whether the person may delete everything they selected (the server still checks each item). */
  canDelete: boolean;
  onClear: () => void;
}) {
  const bulk = useBulk();
  const labels = useLabels(space);
  const [confirm, setConfirm] = useState(false);
  const [assignee, setAssignee] = useState<Person | null>(null);
  const n = ids.length;

  async function run(body: BulkBody, done: (updated: number) => string) {
    try {
      const res = await bulk.mutateAsync(body);
      if (res.failed.length) {
        toast.warning(
          `${res.updated} changed. ${res.failed.length} skipped: ${res.failed
            .slice(0, 3)
            .map((f) => f.key)
            .join(', ')}${res.failed.length > 3 ? '…' : ''}. ${res.failed[0]!.reason}.`,
        );
      } else toast.success(done(res.updated));
      onClear();
    } catch (e) {
      toast.error(errorText(e, 'Could not change those items'));
    }
  }

  return (
    <div
      role="region"
      aria-label="Selected items"
      className="bg-popover text-popover-foreground fixed inset-x-3 bottom-4 z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-xl border p-2 pl-3 shadow-xl sm:inset-x-0"
    >
      <span className="text-sm font-medium tabular-nums" aria-live="polite">
        {n} selected
      </span>
      <span className="bg-border mx-1 h-5 w-px" aria-hidden />

      <Select
        value=""
        onValueChange={(statusId) =>
          run({ action: 'move', ids, statusId }, (u) => `${u} item${u === 1 ? '' : 's'} moved`)
        }
        disabled={bulk.isPending}
      >
        <SelectTrigger size="sm" className="w-36" aria-label="Move selected items to">
          <SelectValue placeholder="Move to…" />
        </SelectTrigger>
        <SelectContent>
          {statuses.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="w-44">
        <AssigneePicker
          space={space}
          value={assignee}
          disabled={bulk.isPending}
          onChange={(p) => {
            setAssignee(p);
            void run(
              { action: 'assign', ids, assigneeId: p?.id ?? null },
              (u) => `${u} item${u === 1 ? '' : 's'} ${p ? `assigned to ${p.name ?? p.email}` : 'unassigned'}`,
            );
          }}
        />
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" disabled={bulk.isPending}>
            <Tag /> Labels
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <p className="text-muted-foreground px-1 pb-1 text-xs">Add or remove a label on all {n}</p>
          <ul className="max-h-60 space-y-1 overflow-y-auto">
            {(labels.data?.items ?? []).map((l) => (
              <li key={l.id} className="flex items-center gap-1">
                <LabelChip label={l} className="mr-auto" />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={() =>
                    run(
                      { action: 'label', ids, labelId: l.id, mode: 'add' },
                      (u) => `“${l.name}” added to ${u} item${u === 1 ? '' : 's'}`,
                    )
                  }
                >
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={() =>
                    run(
                      { action: 'label', ids, labelId: l.id, mode: 'remove' },
                      (u) => `“${l.name}” removed from ${u} item${u === 1 ? '' : 's'}`,
                    )
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
            {labels.isSuccess && labels.data.items.length === 0 && (
              <li className="text-muted-foreground p-1 text-xs">No labels yet. Create one from an item.</li>
            )}
          </ul>
        </PopoverContent>
      </Popover>

      {canDelete && (
        <Button variant="outline" size="sm" disabled={bulk.isPending} onClick={() => setConfirm(true)}>
          <Trash2 /> Delete
        </Button>
      )}
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
        <X /> Clear
      </Button>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {n} item{n === 1 ? '' : 's'}?</AlertDialogTitle>
            <AlertDialogDescription>
              They leave the board and search, and so do any subtasks. History is kept. Items you are not
              allowed to delete are skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => run({ action: 'delete', ids }, (u) => `${u} item${u === 1 ? '' : 's'} deleted`)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
