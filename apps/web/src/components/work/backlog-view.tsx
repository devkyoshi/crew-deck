'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { ArrowRightLeft, CalendarRange, GripVertical, Loader2, MoreHorizontal, Pencil, Play, Plus, Repeat, Trash2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadError } from '@/components/shared/load-error';
import { useSpace } from '@/components/spaces/space-context';
import { ApiError } from '@/lib/api';
import type { WorkItem } from '@/lib/work';
import { toastError, useCreateItem } from '@/lib/work-api';
import {
  dateRange,
  useBacklog,
  useCompleteSprint,
  useCreateSprint,
  useDeleteSprint,
  useMoveToSprint,
  useReorderBacklog,
  useStartSprint,
  useUpdateSprint,
  type SprintSection,
  type Summary,
} from '@/lib/sprints-api';
import { cn } from '@/lib/utils';
import { ItemSheet, useOpenItem } from './item-sheet';
import { useVocabulary } from './use-vocabulary';
import { PriorityIcon, StatusChip, TypeIcon, UserAvatar } from './work-bits';
import { ListSkeleton } from '@/components/shared/skeletons';

const BACKLOG = 'backlog';
/** Droppable id of a row, so dropping on a row can reorder (the draggable keeps the bare item id). */
const ROW = 'row:';

/** Sprint planning: the running sprint, planned sprints and the backlog, with work dragged between them. */
export function BacklogView() {
  const space = useSpace();
  const vocab = useVocabulary();
  const data = useBacklog(space.key);
  const move = useMoveToSprint();
  const reorder = useReorderBacklog(space.key);
  const createSprint = useCreateSprint(space.key);
  const [dragging, setDragging] = useState<WorkItem | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));

  if (data.isError) {
    const notScrum = data.error instanceof ApiError && data.error.code === 'not_scrum';
    return notScrum ? (
      <EmptyState
        title="This space uses a Kanban board"
        description="Sprints need a Scrum board. A space admin can switch it in Board settings, and the backlog appears here."
        action={
          <Button variant="outline" asChild>
            <Link href={`/spaces/${space.key}/board`}>Go to the board</Link>
          </Button>
        }
      />
    ) : (
      <LoadError what="the backlog" onRetry={() => data.refetch()} />
    );
  }
  if (!data.data) return <ListSkeleton rows={3} />;
  const { sprints, backlog, permissions } = data.data;
  const targets = sprints.map((s) => ({ id: s.id, name: s.name }));

  const moveTo = (item: WorkItem, sprintId: string | null) => {
    if ((item.sprintId ?? null) === sprintId) return;
    move.mutate({ ids: [item.id], sprintId }, { onError: (e) => toastError(e, 'Could not move it') });
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const item = e.active.data.current?.item as WorkItem | undefined;
    if (!item || !e.over) return;
    const overId = String(e.over.id);
    if (overId.startsWith(ROW)) {
      // Dropped on another row: reorder when it is in the same list, otherwise move to that row's list.
      const sections = [...sprints.map((s) => ({ sprintId: s.id as string | null, items: s.items })), { sprintId: null, items: backlog.items }];
      const to = sections.find((s) => s.items.some((i) => i.id === overId.slice(ROW.length)));
      if (!to) return;
      if ((item.sprintId ?? null) !== to.sprintId) return moveTo(item, to.sprintId);
      const ids = to.items.map((i) => i.id);
      const from = ids.indexOf(item.id);
      const at = ids.indexOf(overId.slice(ROW.length));
      if (from < 0 || at < 0 || from === at) return;
      ids.splice(at, 0, ...ids.splice(from, 1));
      return reorder.mutate({ sprintId: to.sprintId, ids }, { onError: (err) => toastError(err, 'Could not reorder it') });
    }
    moveTo(item, overId === BACKLOG ? null : overId);
  };

  return (
    <div className="space-y-4">
      {!data.data.features.sprints && (
        <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning-soft-foreground ">
          Your plan does not include sprints. You can plan here, but starting a sprint needs an upgrade.
        </p>
      )}
      <DndContext
        sensors={sensors}
        onDragStart={(e) => setDragging((e.active.data.current?.item as WorkItem) ?? null)}
        onDragCancel={() => setDragging(null)}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => `Picked up ${active.data.current?.item?.key}.`,
            onDragOver: ({ over }) => (over ? `Over ${over.data.current?.label ?? 'a section'}.` : 'Not over a section.'),
            onDragEnd: ({ over, active }) => (over ? `Moved ${active.data.current?.item?.key} to ${over.data.current?.label}.` : 'Dropped back.'),
            onDragCancel: () => 'Move cancelled.',
          },
        }}
      >
        {sprints.map((s) => (
          <SprintBlock key={s.id} sprint={s} canMove={permissions.moveItems} permissions={permissions} targets={targets} onMove={moveTo} others={sprints} />
        ))}
        <Section
          id={BACKLOG}
          label="Backlog"
          header={
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-semibold">Backlog</h2>
              <SummaryText summary={backlog.summary} noun={vocab} />
              {permissions.create && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto h-8"
                  disabled={createSprint.isPending}
                  onClick={() =>
                    createSprint.mutate({}, { onSuccess: (s) => toast.success(`${s.name} created`), onError: (e) => toastError(e, 'Could not create it') })
                  }
                >
                  <Plus /> Create sprint
                </Button>
              )}
            </div>
          }
          items={backlog.items}
          canMove={permissions.moveItems}
          targets={targets}
          onMove={moveTo}
          empty={`The backlog is empty. New ${vocab.nounPlural} start here.`}
          footer={permissions.moveItems ? <InlineCreate /> : null}
        />
        <DragOverlay>{dragging ? <Row item={dragging} canMove={false} targets={[]} onMove={() => undefined} overlay /> : null}</DragOverlay>
      </DndContext>
      <ItemSheet />
    </div>
  );
}

function SummaryText({ summary, noun }: { summary: Summary; noun: ReturnType<typeof useVocabulary> }) {
  return (
    <span className="text-muted-foreground text-xs tabular-nums">
      {noun.count(summary.count)} · {summary.points} pts{summary.done ? ` · ${summary.done} done` : ''}
    </span>
  );
}

function Section({
  id,
  label,
  header,
  items,
  canMove,
  targets,
  onMove,
  empty,
  footer,
  className,
}: {
  id: string;
  label: string;
  header: React.ReactNode;
  items: WorkItem[];
  canMove: boolean;
  targets: { id: string; name: string }[];
  onMove: (item: WorkItem, sprintId: string | null) => void;
  empty: string;
  footer?: React.ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { label } });
  return (
    <section aria-label={label} ref={setNodeRef} className={cn('bg-card rounded-lg border', isOver && 'ring-primary ring-2', className)}>
      <div className="border-b px-3 py-2.5">{header}</div>
      {items.length === 0 ? (
        <p className="text-muted-foreground px-3 py-4 text-sm">{empty}</p>
      ) : (
        <ul className="divide-y">
          {items.map((i) => (
            <Row key={i.id} item={i} canMove={canMove} targets={targets} onMove={onMove} />
          ))}
        </ul>
      )}
      {footer}
    </section>
  );
}

function Row({
  item,
  canMove,
  targets,
  onMove,
  overlay,
}: {
  item: WorkItem;
  canMove: boolean;
  targets: { id: string; name: string }[];
  onMove: (item: WorkItem, sprintId: string | null) => void;
  overlay?: boolean;
}) {
  const open = useOpenItem();
  const { attributes, listeners, setNodeRef: dragRef, isDragging } = useDraggable({ id: item.id, data: { item }, disabled: !canMove || overlay });
  const { setNodeRef: dropRef } = useDroppable({ id: `${ROW}${item.id}`, data: { label: `${item.key}'s list` }, disabled: overlay });
  const setNodeRef = (node: HTMLElement | null) => {
    dragRef(node);
    dropRef(node);
  };
  const done = item.status.category === 'done';
  return (
    <li ref={overlay ? undefined : setNodeRef} className={cn('bg-card flex items-center gap-2 px-2 py-1.5 text-sm', isDragging && 'opacity-40', overlay && 'rounded-lg border shadow-lg')}>
      {canMove ? (
        <button type="button" aria-label={`Drag ${item.key}`} className="text-muted-foreground hover:text-foreground cursor-grab rounded-sm p-1" {...attributes} {...listeners}>
          <GripVertical className="size-4" aria-hidden />
        </button>
      ) : (
        <span className="w-6" />
      )}
      <TypeIcon type={item.type} />
      <span className="text-muted-foreground w-20 shrink-0 tabular-nums">{item.key}</span>
      <button type="button" onClick={() => open(item.key)} className={cn('min-w-0 flex-1 truncate text-left hover:underline', done && 'text-muted-foreground line-through')}>
        {item.title}
      </button>
      {(item.carryOverCount ?? 0) > 0 && (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-warning-soft px-1.5 text-xs font-medium text-warning-soft-foreground " title={`Carried over ${item.carryOverCount} times`}>
          <Repeat className="size-3" aria-hidden />
          {item.carryOverCount}
          <span className="sr-only"> carry-overs</span>
        </span>
      )}
      <PriorityIcon priority={item.priority} />
      <StatusChip name={item.status.name} category={item.status.category} color={item.status.color} className="hidden sm:inline-flex" />
      {item.estimate !== null && <span className="bg-muted w-8 rounded-full text-center text-xs tabular-nums">{item.estimate}</span>}
      <UserAvatar person={item.assignee} size={20} />
      {canMove && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" aria-label={`Move ${item.key}`}>
              <ArrowRightLeft />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Move to</DropdownMenuLabel>
            {targets
              .filter((t) => t.id !== item.sprintId)
              .map((t) => (
                <DropdownMenuItem key={t.id} onSelect={() => onMove(item, t.id)}>
                  {t.name}
                </DropdownMenuItem>
              ))}
            {item.sprintId && <DropdownMenuItem onSelect={() => onMove(item, null)}>Backlog</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

function InlineCreate() {
  const space = useSpace();
  const vocab = useVocabulary();
  const create = useCreateItem(space.key);
  const [title, setTitle] = useState('');
  return (
    <form
      className="flex gap-2 border-t p-2"
      onSubmit={(e) => {
        e.preventDefault();
        const t = title.trim();
        if (!t) return;
        create.mutate({ type: 'story', title: t }, { onSuccess: () => setTitle(''), onError: (err) => toastError(err, 'Could not create it') });
      }}
    >
      <Input aria-label={`New ${vocab.noun} in the backlog`} placeholder={`Add a ${vocab.noun} to the backlog…`} value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} className="h-8" />
      <Button type="submit" size="sm" disabled={!title.trim() || create.isPending}>
        <Plus /> Add
      </Button>
    </form>
  );
}

function SprintBlock({
  sprint,
  permissions,
  canMove,
  targets,
  onMove,
  others,
}: {
  sprint: SprintSection;
  permissions: { create: boolean; start: boolean; complete: boolean };
  canMove: boolean;
  targets: { id: string; name: string }[];
  onMove: (item: WorkItem, sprintId: string | null) => void;
  others: SprintSection[];
}) {
  const vocab = useVocabulary();
  const [dialog, setDialog] = useState<'edit' | 'start' | 'complete' | null>(null);
  const del = useDeleteSprint();
  const active = sprint.state === 'active';
  const hasActive = others.some((s) => s.state === 'active');
  return (
    <>
      <Section
        id={sprint.id}
        label={sprint.name}
        className={cn(active && 'border-primary/40')}
        items={sprint.items}
        canMove={canMove}
        targets={targets}
        onMove={onMove}
        empty={`Plan this sprint by dragging ${vocab.nounPlural} here from the backlog.`}
        header={
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-semibold">{sprint.name}</h2>
              {active && <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">Active</span>}
              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                <CalendarRange className="size-3.5" aria-hidden /> {dateRange(sprint)}
              </span>
              <SummaryText summary={sprint.summary} noun={vocab} />
              <div className="ml-auto flex items-center gap-1">
                {!active && permissions.start && (
                  <Button size="sm" className="h-8" disabled={hasActive} title={hasActive ? 'Complete the running sprint first' : undefined} onClick={() => setDialog('start')}>
                    <Play /> Start sprint
                  </Button>
                )}
                {active && permissions.complete && (
                  <Button size="sm" className="h-8" onClick={() => setDialog('complete')}>
                    Complete sprint
                  </Button>
                )}
                {permissions.create && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8" aria-label={`More for ${sprint.name}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setDialog('edit')}>
                        <Pencil /> Edit sprint
                      </DropdownMenuItem>
                      {!active && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() =>
                              del.mutate(sprint.id, {
                                onSuccess: (r) => toast.success(`${sprint.name} deleted${r.movedToBacklog ? `; ${r.movedToBacklog} back in the backlog` : ''}`),
                                onError: (e) => toastError(e, 'Could not delete it'),
                              })
                            }
                          >
                            <Trash2 /> Delete sprint
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
            {sprint.goal && <p className="text-muted-foreground text-sm">Goal: {sprint.goal}</p>}
          </div>
        }
      />
      {/* Mounted only while open, so each opening starts from the sprint's current values. */}
      {(dialog === 'edit' || dialog === 'start') && (
        <EditSprintDialog sprint={sprint} mode={dialog} open onOpenChange={(o) => !o && setDialog(null)} />
      )}
      {dialog === 'complete' && <CompleteSprintDialog sprint={sprint} others={others} open onOpenChange={(o) => !o && setDialog(null)} />}
    </>
  );
}

const plusDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

function EditSprintDialog({
  sprint,
  mode,
  open,
  onOpenChange,
}: {
  sprint: SprintSection;
  mode: 'edit' | 'start';
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState(sprint.name);
  const [goal, setGoal] = useState(sprint.goal ?? '');
  const [start, setStart] = useState(sprint.startDate ?? today);
  const [end, setEnd] = useState(sprint.endDate ?? plusDays(sprint.startDate ?? today, 13));
  const update = useUpdateSprint();
  const startSprint = useStartSprint();
  const busy = update.isPending || startSprint.isPending;
  const vocab = useVocabulary();

  async function submit() {
    if (end < start) return toast.error('The end date is before the start date');
    try {
      await update.mutateAsync({ id: sprint.id, name: name.trim(), goal: goal.trim() || null, startDate: start, endDate: end });
      if (mode === 'start') {
        const r = await startSprint.mutateAsync({ id: sprint.id, startDate: start, endDate: end });
        toast.success(`${r.name} started with ${vocab.count(r.items)} (${r.points} pts)`);
      }
      onOpenChange(false);
    } catch (e) {
      toastError(e, mode === 'start' ? 'Could not start the sprint' : 'Could not save it');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'start' ? `Start ${sprint.name}` : `Edit ${sprint.name}`}</DialogTitle>
          <DialogDescription>
            {mode === 'start'
              ? `${vocab.count(sprint.summary.count)} (${sprint.summary.points} pts) will be in this sprint. The board shows the running sprint.`
              : 'Name, goal and dates.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="sprint-name">Name</Label>
            <Input id="sprint-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sprint-start">Start date</Label>
              <Input id="sprint-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sprint-end">End date</Label>
              <Input id="sprint-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sprint-goal">Goal (optional)</Label>
            <Textarea id="sprint-goal" value={goal} maxLength={500} onChange={(e) => setGoal(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {busy && <Loader2 className="animate-spin" />} {mode === 'start' ? 'Start' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CompleteSprintDialog({
  sprint,
  others,
  open,
  onOpenChange,
}: {
  sprint: SprintSection;
  others: SprintSection[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const vocab = useVocabulary();
  const complete = useCompleteSprint();
  const planned = others.filter((s) => s.state === 'planned');
  const [destination, setDestination] = useState<string>(planned[0]?.id ?? 'new');
  const open_ = sprint.summary.count - sprint.summary.done;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete {sprint.name}</DialogTitle>
          <DialogDescription>
            {vocab.count(sprint.summary.done)} done ({sprint.summary.donePoints} pts). {open_ ? `${vocab.count(open_)} not finished.` : 'Everything is finished.'}
          </DialogDescription>
        </DialogHeader>
        {open_ > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="complete-dest">Move unfinished {vocab.nounPlural} to</Label>
            <Select value={destination} onValueChange={setDestination}>
              <SelectTrigger id="complete-dest">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {planned.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
                <SelectItem value="new">A new sprint</SelectItem>
                <SelectItem value="backlog">The backlog</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">Finished work stays in this sprint and in its report.</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={complete.isPending}
            onClick={() =>
              complete.mutate(
                { id: sprint.id, destination: open_ ? destination : 'backlog' },
                {
                  onSuccess: (r) => {
                    toast.success(`${r.name} completed${r.movedTo ? `; ${vocab.count(r.moved)} moved to ${r.movedTo.name}` : ''}`);
                    onOpenChange(false);
                  },
                  onError: (e) => toastError(e, 'Could not complete the sprint'),
                },
              )
            }
          >
            {complete.isPending && <Loader2 className="animate-spin" />} Complete sprint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
