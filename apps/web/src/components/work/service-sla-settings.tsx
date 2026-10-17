'use client';

import { useEffect, useState } from 'react';
import { toast } from '@/lib/toast';
import { PRIORITIES, type Priority } from '@crew-deck/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { LoadError } from '@/components/shared/load-error';
import { useSaveSla, useSla, type SlaPolicy } from '@/lib/sla-api';
import { PRIORITY_META } from '@/lib/work';
import { toastError } from '@/lib/work-api';
import { ListSkeleton } from '@/components/shared/skeletons';

/** Targets are typed in hours (decimals allowed) and stored as whole minutes. */
const toHours = (minutes: number) => String(Math.round((minutes / 60) * 100) / 100);
const toMinutes = (hours: string) => Math.round(Number(hours) * 60);

type Draft = { businessHours: boolean; targets: Record<Priority, { response: string; resolve: string }> };

const toDraft = (p: SlaPolicy): Draft => ({
  businessHours: p.businessHours,
  targets: Object.fromEntries(
    PRIORITIES.map((k) => [k, { response: toHours(p.targets[k].responseMinutes), resolve: toHours(p.targets[k].resolveMinutes) }]),
  ) as Draft['targets'],
});

/**
 * Response and resolve targets for a service desk, per priority. They apply to tickets raised from now
 * on (and re-start a ticket's clock if its priority changes); tickets already open keep their deadlines.
 */
export function ServiceSlaSettings({ spaceKey }: { spaceKey: string }) {
  const sla = useSla(spaceKey);
  const save = useSaveSla(spaceKey);
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    if (sla.data) setDraft(toDraft(sla.data.policy));
  }, [sla.data]);

  if (sla.isError) return <LoadError what="the response targets" onRetry={() => void sla.refetch()} />;
  if (!sla.data || !draft) return <ListSkeleton rows={3} />;
  const canManage = sla.data.permissions.manage;

  const valid = PRIORITIES.every((k) => {
    const t = draft.targets[k];
    return toMinutes(t.response) >= 1 && toMinutes(t.resolve) >= 1 && Number.isFinite(toMinutes(t.response + t.resolve));
  });
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(sla.data.policy));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const policy: SlaPolicy = {
      businessHours: draft.businessHours,
      targets: Object.fromEntries(
        PRIORITIES.map((k) => [
          k,
          { responseMinutes: toMinutes(draft.targets[k].response), resolveMinutes: toMinutes(draft.targets[k].resolve) },
        ]),
      ) as SlaPolicy['targets'],
    };
    save.mutate(policy, {
      onSuccess: () => toast.success('Response targets saved'),
      onError: (err) => toastError(err, 'Could not save the targets'),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <label htmlFor="sla-business" className="text-sm font-medium">
            Count working hours only
          </label>
          <p className="text-muted-foreground text-xs">
            Nights, weekends and days off do not count. Set the working week under Admin → Settings → Work.
          </p>
        </div>
        <Switch
          id="sla-business"
          checked={draft.businessHours}
          disabled={!canManage}
          onCheckedChange={(v) => setDraft({ ...draft, businessHours: v })}
        />
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="sr-only">Response and resolve targets in hours, by priority</caption>
          <thead className="text-muted-foreground bg-muted/40 text-xs">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Priority
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                First response (hours)
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Resolve (hours)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {PRIORITIES.map((k) => (
              <tr key={k}>
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {PRIORITY_META[k].label}
                </th>
                {(['response', 'resolve'] as const).map((clock) => (
                  <td key={clock} className="px-3 py-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0.01}
                      step="any"
                      className="h-8 w-28"
                      aria-label={`${PRIORITY_META[k].label} priority, ${clock === 'response' ? 'first response' : 'resolve'} hours`}
                      value={draft.targets[k][clock]}
                      disabled={!canManage}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          targets: { ...draft.targets, [k]: { ...draft.targets[k], [clock]: e.target.value } },
                        })
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && (
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!dirty || !valid || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save targets'}
          </Button>
        </div>
      )}
    </form>
  );
}
