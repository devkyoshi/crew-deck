'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Notice } from '@/components/shared/notice';
import { useMe } from '@/components/shell/me-context';
import { useSpace } from '@/components/spaces/space-context';
import { ApiError } from '@/lib/api';
import { useCreateItem, errorText } from '@/lib/work-api';
import {
  type ItemType,
  type Label as WorkLabel,
  type Person,
  type Priority,
  type WorkItem,
  type WorkStatus,
} from '@/lib/work';
import { cn } from '@/lib/utils';
import { LabelPicker } from './label-bits';
import { ComponentPicker, VersionPicker } from './version-bits';
import { useComponents, useVersions } from '@/lib/versions-api';
import { TypeIcon } from './work-bits';
import { AssigneePicker, ItemPicker, PrioritySelect, StatusSelect, STORY_POINTS } from './work-pickers';
import { useVocabulary } from './use-vocabulary';

type Parent = { id: string; key: string; title: string; type: ItemType } | null;

const TYPES: ItemType[] = ['story', 'task', 'bug', 'epic', 'subtask'];

export function CreateItemDialog({
  spaceKey,
  statuses,
  open,
  onOpenChange,
  defaults,
  onCreated,
}: {
  spaceKey: string;
  statuses: Pick<WorkStatus, 'id' | 'name' | 'category' | 'color'>[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults?: {
    statusId?: string;
    type?: ItemType;
    parent?: Parent;
    assignee?: Person | null;
    labels?: WorkLabel[];
  };
  onCreated?: (item: WorkItem) => void;
}) {
  const vocab = useVocabulary();
  const me = useMe();
  const features = useSpace().features;
  // Tickets only where the space takes them, epics only where it uses them.
  const hasTickets = features.includes('tickets');
  const hasEpics = features.includes('epics');
  // A space that is only a ticket queue opens on "ticket" rather than "task".
  const isService = hasTickets && !hasEpics && !features.includes('sprints');
  const create = useCreateItem(spaceKey);
  const firstTodo = statuses.find((s) => s.category === 'todo') ?? statuses[0];

  const [type, setType] = useState<ItemType>('task');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [statusId, setStatusId] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [assignee, setAssignee] = useState<Person | null>(null);
  const [estimate, setEstimate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [parent, setParent] = useState<Parent>(null);
  const [chosenLabels, setChosenLabels] = useState<WorkLabel[]>([]);
  const [versionIds, setVersionIds] = useState<string[]>([]);
  const [componentIds, setComponentIds] = useState<string[]>([]);
  const versionList = useVersions(spaceKey);
  const componentList = useComponents(spaceKey);
  const [another, setAnother] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [titleError, setTitleError] = useState('');

  // Start fresh each time the dialog opens, using the column or filter it was opened from.
  useEffect(() => {
    if (!open) return;
    setType(defaults?.type ?? (isService ? 'ticket' : 'task'));
    setTitle('');
    setDescription('');
    setStatusId(defaults?.statusId ?? firstTodo?.id ?? '');
    setPriority('medium');
    setAssignee(defaults?.assignee ?? null);
    setEstimate('');
    setDueDate('');
    setParent(defaults?.parent ?? null);
    setChosenLabels(defaults?.labels ?? []);
    setVersionIds([]);
    setComponentIds([]);
    setError(null);
    setTitleError('');
  }, [open]);

  const needsParent = type === 'subtask';
  const showEpic = type === 'story' || type === 'task' || type === 'bug';
  const isAdmin = me.permissions.includes('settings.manage');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      setTitleError('Enter a title');
      return;
    }
    if (needsParent && !parent) {
      setError(new ApiError(422, 'invalid_hierarchy', 'Choose the story, task or bug this subtask belongs to'));
      return;
    }
    const points = estimate.trim() === '' ? null : Number(estimate);
    if (points !== null && (!Number.isFinite(points) || points < 0 || points > 999.9)) {
      setError(new ApiError(400, 'validation_error', 'Estimate must be a number between 0 and 999.9'));
      return;
    }
    setError(null);
    try {
      const item = await create.mutateAsync({
        type,
        title: t,
        description: description.trim() || undefined,
        statusId: statusId || undefined,
        priority,
        assigneeId: assignee?.id ?? null,
        estimate: points,
        dueDate: dueDate || null,
        parentId: type === 'epic' ? null : (parent?.id ?? null),
        labelIds: chosenLabels.map((l) => l.id),
        ...(versionIds.length ? { fixVersionIds: versionIds } : {}),
        ...(componentIds.length ? { componentIds } : {}),
      });
      onCreated?.(item);
      toast.success(`${item.key} created`, {
        action: { label: 'Open', onClick: () => (window.location.href = `/spaces/${spaceKey}/items/${item.key}`) },
      });
      if (another) {
        setTitle('');
        setDescription('');
        setTitleError('');
        document.getElementById('create-title')?.focus();
      } else onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(500, 'error', errorText(err)));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>{isService ? 'New ticket' : `Create ${vocab.noun}`}</DialogTitle>
            <DialogDescription>It starts in the status you choose and gets the next key in this space.</DialogDescription>
          </DialogHeader>

          {error && (
            <Notice
              variant={error.code === 'plan_limit' || error.code === 'feature_locked' ? 'warning' : 'error'}
              title={error.code === 'plan_limit' ? 'Your plan’s limit is reached' : undefined}
              action={
                (error.code === 'plan_limit' || error.code === 'feature_locked') && isAdmin ? (
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/admin/billing">See plans</Link>
                  </Button>
                ) : undefined
              }
            >
              {error.message}
              {(error.code === 'plan_limit') && !isAdmin ? ' Ask a workspace admin to upgrade.' : ''}
            </Notice>
          )}

          <div role="radiogroup" aria-label="Type" className="flex flex-wrap gap-1.5">
            {[...(hasTickets ? (['ticket'] as ItemType[]) : []), ...TYPES]
              .filter((t) => t === 'ticket' || t === type || (vocab.allowedTypes.includes(t) && (t !== 'epic' || hasEpics)))
              .map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                onClick={() => setType(t)}
                className={cn(
                  'hover:bg-accent inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2',
                  type === t && 'border-primary bg-accent ring-primary/30 font-medium ring-1',
                )}
              >
                <TypeIcon type={t} /> {vocab.typeLabel(t)}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="create-title">Title</Label>
            <Input
              id="create-title"
              autoFocus
              maxLength={255}
              value={title}
              aria-invalid={!!titleError}
              placeholder="Summarise the work in a line"
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleError('');
              }}
            />
            {titleError && <p className="text-destructive text-xs">{titleError}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="create-desc">Description</Label>
            <Textarea
              id="create-desc"
              rows={3}
              maxLength={20000}
              value={description}
              placeholder="Optional. What does done look like?"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <fieldset className="space-y-3">
            <legend className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
              Planning
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="create-status">Status</Label>
                <StatusSelect id="create-status" statuses={statuses} value={statusId} onChange={setStatusId} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-priority">Priority</Label>
                <PrioritySelect id="create-priority" value={priority} onChange={setPriority} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-assignee">Assignee</Label>
                <AssigneePicker id="create-assignee" space={spaceKey} value={assignee} onChange={setAssignee} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-due">Due date</Label>
                <Input id="create-due" type="date" className="h-8" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="create-labels">Labels</Label>
                <LabelPicker id="create-labels" space={spaceKey} value={chosenLabels} onChange={setChosenLabels} />
              </div>
              {(versionList.data?.items.length ?? 0) > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="create-version">Fix version</Label>
                  <VersionPicker
                    id="create-version"
                    space={spaceKey}
                    label="Fix version"
                    value={(versionList.data?.items ?? []).filter((v) => versionIds.includes(v.id))}
                    onChange={setVersionIds}
                  />
                </div>
              )}
              {(componentList.data?.items.length ?? 0) > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="create-components">Components</Label>
                  <ComponentPicker
                    id="create-components"
                    space={spaceKey}
                    value={(componentList.data?.items ?? []).filter((c) => componentIds.includes(c.id))}
                    onChange={setComponentIds}
                  />
                </div>
              )}
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="create-estimate">Estimate (story points)</Label>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Input
                    id="create-estimate"
                    inputMode="decimal"
                    className="h-8 w-24"
                    placeholder="None"
                    value={estimate}
                    onChange={(e) => setEstimate(e.target.value)}
                  />
                  {STORY_POINTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={estimate === String(p)}
                      onClick={() => setEstimate(estimate === String(p) ? '' : String(p))}
                      className={cn(
                        'hover:bg-accent h-6 min-w-6 rounded-full border px-1.5 text-xs font-semibold tabular-nums',
                        estimate === String(p) && 'bg-primary text-primary-foreground hover:bg-primary border-transparent',
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </fieldset>

          {(needsParent || showEpic) && (
            <fieldset className="space-y-1.5">
              <legend className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
                Relations
              </legend>
              <Label htmlFor="create-parent">{needsParent ? 'Parent (required)' : 'Epic'}</Label>
              <ItemPicker
                id="create-parent"
                space={spaceKey}
                types={needsParent ? ['story', 'task', 'bug'] : ['epic']}
                value={parent && (needsParent ? parent.type !== 'epic' : parent.type === 'epic') ? parent : null}
                onChange={setParent}
                placeholder={needsParent ? 'Choose a story, task or bug' : 'No epic'}
              />
            </fieldset>
          )}

          <DialogFooter className="items-center gap-3 sm:justify-between">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={another} onCheckedChange={setAnother} aria-label="Create another" />
              Create another
            </label>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
