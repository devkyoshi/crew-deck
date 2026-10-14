'use client';

import { useSetBoardType } from '@/lib/sprints-api';
import { useHasFeature } from '@/lib/plans';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { STATUS_COLORS, type StatusColor } from '@crew-deck/shared';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadError } from '@/components/shared/load-error';
import { api } from '@/lib/api';
import { errorText, refreshWork, statusesKey, useStatuses } from '@/lib/work-api';
import {
  CATEGORY_META,
  STATUS_DOT,
  type BoardData,
  type BoardSettings,
  type StatusCategory,
  type WorkStatus,
} from '@/lib/work';
import { cn } from '@/lib/utils';
import { useVocabulary } from './use-vocabulary';

const CARD_FIELD_LABELS: Record<BoardSettings['cardFields'][number], string> = {
  assignee: 'Assignee',
  priority: 'Priority',
  estimate: 'Estimate',
  dueDate: 'Due date',
  epic: 'Epic',
  labels: 'Labels',
  subtasks: 'Subtask progress',
};

export function BoardSettingsSheet({
  spaceKey,
  open,
  onOpenChange,
  board,
  onSaved,
}: {
  spaceKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: BoardData['board'];
  onSaved: () => void;
}) {
  const vocab = useVocabulary();
  const [fields, setFields] = useState(board.settings.cardFields);
  const [retention, setRetention] = useState(String(board.settings.doneRetentionDays));
  useEffect(() => {
    setFields(board.settings.cardFields);
    setRetention(String(board.settings.doneRetentionDays));
  }, [board.settings]);

  async function saveSettings(patch: Partial<BoardSettings>) {
    try {
      await api(`/boards/${board.id}`, { method: 'PATCH', body: { settings: patch } });
      onSaved();
    } catch (e) {
      toast.error(errorText(e, 'Could not save board settings'));
      setFields(board.settings.cardFields);
      setRetention(String(board.settings.doneRetentionDays));
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Board settings</SheetTitle>
          <SheetDescription>Columns, what cards show, and how long finished work stays on the board.</SheetDescription>
        </SheetHeader>
        <div className="space-y-8 px-4 pb-8">
          <section aria-labelledby="bs-statuses" className="space-y-3">
            <div>
              <h3 id="bs-statuses" className="text-sm font-semibold">
                Statuses (columns)
              </h3>
              <p className="text-muted-foreground text-xs">
                Drag to reorder. Every space keeps at least one status in To do, In progress and Done.
              </p>
            </div>
            <StatusEditor spaceKey={spaceKey} />
          </section>

          <section aria-labelledby="bs-cards" className="space-y-3">
            <h3 id="bs-cards" className="text-sm font-semibold">
              Card fields
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(CARD_FIELD_LABELS) as (keyof typeof CARD_FIELD_LABELS)[]).map((f) => (
                <label key={f} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={fields.includes(f)}
                    onCheckedChange={(on) => {
                      const next = on ? [...fields, f] : fields.filter((x) => x !== f);
                      setFields(next);
                      void saveSettings({ cardFields: next });
                    }}
                  />
                  {CARD_FIELD_LABELS[f]}
                </label>
              ))}
            </div>
          </section>

          <section aria-labelledby="bs-done" className="space-y-2">
            <h3 id="bs-done" className="text-sm font-semibold">
              Finished work
            </h3>
            <Label htmlFor="bs-retention" className="text-muted-foreground text-xs font-normal">
              Hide finished {vocab.nounPlural} from the board after this many days (they stay searchable)
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="bs-retention"
                type="number"
                min={1}
                max={365}
                className="h-8 w-24"
                value={retention}
                onChange={(e) => setRetention(e.target.value)}
                onBlur={() => {
                  const n = Number(retention);
                  if (!Number.isInteger(n) || n < 1 || n > 365) {
                    toast.error('Enter a whole number of days from 1 to 365');
                    setRetention(String(board.settings.doneRetentionDays));
                  } else if (n !== board.settings.doneRetentionDays) {
                    void saveSettings({ doneRetentionDays: n });
                  }
                }}
              />
              <span className="text-sm">days</span>
            </div>
          </section>

          <section aria-labelledby="bs-lanes" className="space-y-2">
            <h3 id="bs-lanes" className="text-sm font-semibold">
              Swimlanes
            </h3>
            <Label htmlFor="bs-swimlane" className="text-muted-foreground text-xs font-normal">
              Split the board into rows. Dropping a card into another row changes that field.
            </Label>
            <Select
              value={board.settings.swimlane}
              onValueChange={(v) => void saveSettings({ swimlane: v as BoardSettings['swimlane'] })}
            >
              <SelectTrigger id="bs-swimlane" size="sm" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="assignee">Assignee</SelectItem>
                <SelectItem value="epic">Epic</SelectItem>
                <SelectItem value="priority">Priority</SelectItem>
              </SelectContent>
            </Select>
          </section>

          <section aria-labelledby="bs-other" className="space-y-2">
            <h3 id="bs-other" className="text-sm font-semibold">
              Board type
            </h3>
            <BoardTypeSwitch spaceKey={spaceKey} type={board.type} />
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---- Status editor -----------------------------------------------------------------------------------------

function StatusEditor({ spaceKey }: { spaceKey: string }) {
  const vocab = useVocabulary();
  const qc = useQueryClient();
  const query = useStatuses(spaceKey);
  const [order, setOrder] = useState<WorkStatus[]>([]);
  const [removing, setRemoving] = useState<WorkStatus | null>(null);
  const [replacement, setReplacement] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<StatusCategory>('in_progress');
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (query.data) setOrder(query.data.items);
  }, [query.data]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const reload = () => {
    void qc.invalidateQueries({ queryKey: statusesKey(spaceKey) });
    void refreshWork(qc);
  };

  async function run<T>(p: Promise<T>, fail: string) {
    try {
      const r = await p;
      reload();
      return r;
    } catch (e) {
      toast.error(errorText(e, fail));
      reload();
      return undefined;
    }
  }

  async function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const from = order.findIndex((s) => s.id === e.active.id);
    const to = order.findIndex((s) => s.id === e.over!.id);
    const next = arrayMove(order, from, to);
    setOrder(next);
    await run(
      api(`/spaces/${spaceKey}/statuses/order`, { method: 'PUT', body: { ids: next.map((s) => s.id) } }),
      'Could not reorder the statuses',
    );
  }

  if (query.isPending) return <Skeleton className="h-40 w-full" />;
  if (query.isError) return <LoadError what="the statuses" onRetry={() => query.refetch()} />;

  const max = query.data.max;
  const inCategory = (c: StatusCategory) => order.filter((s) => s.category === c).length;
  const atMax = order.length >= max;

  return (
    <div className="space-y-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {order.map((s) => (
              <StatusRow
                key={s.id}
                status={s}
                lastInCategory={inCategory(s.category) <= 1}
                onPatch={(patch) =>
                  run(api(`/statuses/${s.id}`, { method: 'PATCH', body: patch }), 'Could not save that status')
                }
                onRemove={() => {
                  setReplacement(order.find((o) => o.id !== s.id && o.category === s.category)?.id ?? order.find((o) => o.id !== s.id)!.id);
                  setRemoving(s);
                }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <form
        className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const name = newName.trim();
          if (!name) return;
          setAdding(true);
          const r = await run(
            api(`/spaces/${spaceKey}/statuses`, { method: 'POST', body: { name, category: newCategory } }),
            'Could not add the status',
          );
          setAdding(false);
          if (r) setNewName('');
        }}
      >
        <div className="min-w-32 flex-1 space-y-1">
          <Label htmlFor="new-status" className="text-xs">
            New status
          </Label>
          <Input
            id="new-status"
            className="h-8"
            maxLength={40}
            placeholder={atMax ? `Limit of ${max} reached` : 'For example: Blocked'}
            disabled={atMax}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="new-status-cat">
            Category
          </Label>
          <CategorySelect id="new-status-cat" value={newCategory} onChange={setNewCategory} disabled={atMax} />
        </div>
        <Button type="submit" size="sm" disabled={atMax || adding || !newName.trim()}>
          <Plus /> Add
        </Button>
      </form>
      <p className="text-muted-foreground text-xs tabular-nums">
        {order.length} of {max} statuses
      </p>

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{removing?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing && (removing.itemCount ?? 0) > 0
                ? `${vocab.count(removing.itemCount ?? 0)} in this column will move to the status you choose.`
                : `No ${vocab.nounPlural} are in this column.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removing && (removing.itemCount ?? 0) > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="replace-with">Move {vocab.nounPlural} to</Label>
              <Select value={replacement} onValueChange={setReplacement}>
                <SelectTrigger id="replace-with" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {order
                    .filter((o) => o.id !== removing.id)
                    .map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name} ({CATEGORY_META[o.category].label})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const target = removing!;
                setRemoving(null);
                const q = (target.itemCount ?? 0) > 0 ? `?replace_with=${replacement}` : '';
                const r = await run(api(`/statuses/${target.id}${q}`, { method: 'DELETE' }), 'Could not delete the status');
                if (r) toast.success(`“${target.name}” deleted`);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CategorySelect({
  value,
  onChange,
  disabled,
  id,
  label,
}: {
  value: StatusCategory;
  onChange: (c: StatusCategory) => void;
  disabled?: boolean;
  id?: string;
  label?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as StatusCategory)} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label} size="sm" className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(CATEGORY_META) as StatusCategory[]).map((c) => {
          const Icon = CATEGORY_META[c].icon;
          return (
            <SelectItem key={c} value={c}>
              <span className="flex items-center gap-2">
                <Icon className="size-3.5" aria-hidden /> {CATEGORY_META[c].label}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function StatusRow({
  status,
  lastInCategory,
  onPatch,
  onRemove,
}: {
  status: WorkStatus;
  lastInCategory: boolean;
  onPatch: (patch: Record<string, unknown>) => Promise<unknown>;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: status.id });
  const [name, setName] = useState(status.name);
  const [wip, setWip] = useState(status.wipLimit ? String(status.wipLimit) : '');
  useEffect(() => setName(status.name), [status.name]);
  useEffect(() => setWip(status.wipLimit ? String(status.wipLimit) : ''), [status.wipLimit]);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('bg-card flex flex-wrap items-center gap-2 rounded-lg border p-2', isDragging && 'z-10 shadow-lg')}
    >
      <button
        type="button"
        className="text-muted-foreground hover:bg-accent cursor-grab rounded p-1 outline-none focus-visible:ring-2 active:cursor-grabbing"
        aria-label={`Reorder ${status.name}. Press space, then use arrow keys.`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Colour of ${status.name}: ${status.color}`}
            className="hover:bg-accent rounded p-1.5 outline-none focus-visible:ring-2"
          >
            <span className={cn('block size-3.5 rounded-full', STATUS_DOT[status.color])} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Colour">
            {STATUS_COLORS.map((c: StatusColor) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={status.color === c}
                aria-label={c}
                onClick={() => void onPatch({ color: c })}
                className={cn(
                  'size-6 rounded-full outline-none focus-visible:ring-2',
                  STATUS_DOT[c],
                  status.color === c && 'ring-foreground ring-2 ring-offset-2 ring-offset-background',
                )}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <Input
        aria-label={`Name of ${status.name}`}
        className="h-8 min-w-28 flex-1"
        maxLength={40}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const n = name.trim();
          if (!n) setName(status.name);
          else if (n !== status.name) void onPatch({ name: n });
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <span className="text-muted-foreground w-8 text-right text-xs tabular-nums" title="Items in this column">
        {status.itemCount ?? 0}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={onRemove}
        disabled={lastInCategory}
        aria-label={`Delete ${status.name}`}
        title={lastInCategory ? 'Every category needs at least one status' : undefined}
      >
        <Trash2 />
      </Button>
      <div className="flex basis-full items-center gap-2 pl-9">
      <CategorySelect
          label={`Category of ${status.name}`}
          value={status.category}
          onChange={(c) => void onPatch({ category: c })}
          disabled={lastInCategory}
        />
      <Input
        aria-label={`Work-in-progress limit for ${status.name}`}
        className="h-8 w-16"
        inputMode="numeric"
        placeholder="WIP"
        title="Work-in-progress limit (optional, only warns)"
        value={wip}
        onChange={(e) => setWip(e.target.value.replace(/\D/g, ''))}
        onBlur={() => {
          const n = wip === '' ? null : Number(wip);
          if (n !== (status.wipLimit ?? null)) void onPatch({ wipLimit: n && n > 0 ? n : null });
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      </div>
    </li>
  );
}

/** Kanban or Scrum. Scrum needs the plan's sprints feature; switching back keeps sprints and returns planned work. */
function BoardTypeSwitch({ spaceKey, type }: { spaceKey: string; type: 'kanban' | 'scrum' }) {
  const setType = useSetBoardType(spaceKey);
  const scrumAllowed = useHasFeature('scrum_sprints');
  const other = type === 'kanban' ? 'scrum' : 'kanban';
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-sm">
        {type === 'kanban'
          ? 'Kanban: continuous flow, work moves across the columns.'
          : 'Scrum: a backlog and sprints. The board shows the running sprint.'}
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={setType.isPending || (other === 'scrum' && !scrumAllowed)}
        onClick={() =>
          setType.mutate(other, {
            onSuccess: (r) =>
              toast.success(
                `Switched to ${other === 'scrum' ? 'Scrum' : 'Kanban'}${r.movedToBacklog ? `; ${r.movedToBacklog} planned items are back in the backlog` : ''}`,
              ),
            onError: (e) => toast.error(errorText(e, 'Could not switch')),
          })
        }
      >
        Switch to {other === 'scrum' ? 'Scrum' : 'Kanban'}
      </Button>
      {other === 'scrum' && !scrumAllowed && (
        <p className="text-muted-foreground text-xs">Scrum boards are part of the Team plan and above.</p>
      )}
    </div>
  );
}
