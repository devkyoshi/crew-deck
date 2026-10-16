'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { LoadError } from '@/components/shared/load-error';
import { toastError, useStatuses } from '@/lib/work-api';
import {
  useChecklistTemplates,
  useCreateTemplate,
  useDeleteTemplate,
  useSaveWorkflow,
  useWorkflow,
  type Workflow,
} from '@/lib/workflow-api';

/**
 * Which status may follow which. Off by default (anything can move anywhere). Turning it on shows a
 * grid: each row is where work is now, each box a status it may move to. A row with every box ticked
 * (or none) is unrestricted.
 */
export function WorkflowSettings({ spaceKey }: { spaceKey: string }) {
  const workflow = useWorkflow(spaceKey);
  const statuses = useStatuses(spaceKey);
  const save = useSaveWorkflow(spaceKey);
  const [draft, setDraft] = useState<Workflow | null>(null);
  useEffect(() => {
    if (workflow.data) setDraft({ restricted: workflow.data.restricted, transitions: workflow.data.transitions });
  }, [workflow.data]);

  if (workflow.isError || statuses.isError) {
    return <LoadError what="the workflow rules" onRetry={() => void workflow.refetch()} />;
  }
  if (!workflow.data || !statuses.data || !draft) return <p className="text-muted-foreground text-sm">Loading…</p>;
  const list = statuses.data.items;
  const canManage = workflow.data.permissions.manage;

  const allowed = (from: string, to: string) => {
    const row = draft.transitions[from];
    return row === undefined || row.includes(to);
  };
  const toggle = (from: string, to: string) => {
    const current = draft.transitions[from] ?? list.filter((s) => s.id !== from).map((s) => s.id);
    const next = current.includes(to) ? current.filter((x) => x !== to) : [...current, to];
    const everyone = list.filter((s) => s.id !== from).every((s) => next.includes(s.id));
    const transitions = { ...draft.transitions };
    if (everyone) delete transitions[from];
    else transitions[from] = next;
    setDraft({ ...draft, transitions });
  };
  const persist = (next: Workflow) =>
    save.mutate(next, { onSuccess: () => toast.success('Workflow saved'), onError: (e) => toastError(e, 'Could not save the rules') });
  const dirty = JSON.stringify(draft) !== JSON.stringify({ restricted: workflow.data.restricted, transitions: workflow.data.transitions });

  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Only allow the moves ticked below</span>
        <Switch
          checked={draft.restricted}
          disabled={!canManage}
          aria-label="Only allow the moves ticked below"
          onCheckedChange={(restricted) => {
            const next = { ...draft, restricted };
            setDraft(next);
            if (!restricted) persist(next);
          }}
        />
      </label>
      {draft.restricted && (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <caption className="sr-only">Allowed moves between statuses</caption>
              <thead className="text-muted-foreground border-b">
                <tr>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">
                    From
                  </th>
                  {list.map((s) => (
                    <th key={s.id} scope="col" className="px-2 py-1.5 text-center font-medium">
                      <span className="sr-only">To </span>
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.map((from) => (
                  <tr key={from.id}>
                    <th scope="row" className="px-2 py-1.5 text-left font-medium">
                      {from.name}
                    </th>
                    {list.map((to) => (
                      <td key={to.id} className="px-2 py-1.5 text-center">
                        {from.id === to.id ? (
                          <span className="text-muted-foreground" aria-hidden>
                            –
                          </span>
                        ) : (
                          <Checkbox
                            aria-label={`Allow ${from.name} to ${to.name}`}
                            checked={allowed(from.id, to.id)}
                            disabled={!canManage}
                            onCheckedChange={() => toggle(from.id, to.id)}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canManage && (
            <Button size="sm" disabled={!dirty || save.isPending} onClick={() => persist(draft)}>
              Save rules
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/** Lists the space's reusable checklists; admins can add and remove them. */
export function ChecklistTemplates({ spaceKey }: { spaceKey: string }) {
  const templates = useChecklistTemplates(spaceKey);
  const create = useCreateTemplate(spaceKey);
  const remove = useDeleteTemplate(spaceKey);
  const [name, setName] = useState('');
  const [entries, setEntries] = useState('');
  if (templates.isError) return <LoadError what="the checklists" onRetry={() => void templates.refetch()} />;
  if (!templates.data) return <p className="text-muted-foreground text-sm">Loading…</p>;
  const canManage = templates.data.permissions.manage;
  const lines = entries
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return (
    <div className="space-y-3">
      {templates.data.items.length === 0 && <p className="text-muted-foreground text-sm">No checklists yet.</p>}
      <ul className="space-y-1.5">
        {templates.data.items.map((t) => (
          <li key={t.id} className="flex items-start gap-2 rounded-lg border p-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t.name}</p>
              <p className="text-muted-foreground truncate text-xs">{t.items.join(' · ')}</p>
            </div>
            {canManage && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`Delete ${t.name}`}
                onClick={() => remove.mutate(t.id, { onError: (e) => toastError(e, 'Could not delete it') })}
              >
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(
              { name: name.trim(), items: lines },
              {
                onSuccess: () => {
                  setName('');
                  setEntries('');
                },
                onError: (err) => toastError(err, 'Could not add it'),
              },
            );
          }}
        >
          <Input aria-label="Checklist name" placeholder="Name, for example Release steps" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className="h-8" />
          <textarea
            aria-label="Checklist entries, one per line"
            placeholder="One entry per line"
            value={entries}
            onChange={(e) => setEntries(e.target.value)}
            rows={4}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!name.trim() || lines.length === 0 || create.isPending}>
            <Plus /> Add checklist
          </Button>
        </form>
      )}
    </div>
  );
}
