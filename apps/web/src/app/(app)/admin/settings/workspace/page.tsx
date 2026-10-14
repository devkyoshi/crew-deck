'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { WORKSPACE_TEMPLATES, isWorkType, type WorkType } from '@crew-deck/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { useIsAdmin, useMe } from '@/components/shell/me-context';
import { Button } from '@/components/ui/button';
import { UsagePicker, WorkTypePicker } from '@/components/workspace/work-type-picker';
import { api, ApiError } from '@/lib/api';

const MODULE_LABEL: Record<string, string> = {
  members: 'People and groups',
  spaces: 'Spaces and boards',
  checkin: 'Check-in and attendance',
  crm: 'CRM',
};

/** What the workspace is for. Changing it adds the matching modules; it never switches any off. */
export default function WorkspacePurposePage() {
  const isAdmin = useIsAdmin();
  const { org } = useMe();
  const router = useRouter();
  const [workType, setWorkType] = useState<WorkType | null>(isWorkType(org.workType) ? org.workType : null);
  const [usage, setUsage] = useState<string[]>(org.usage ?? []);
  const [busy, setBusy] = useState(false);

  if (!isAdmin) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Admins only"
        description="You need to be a workspace admin to change this."
      />
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!workType) return toast.error('Choose the kind of work first');
    setBusy(true);
    try {
      await api('/settings/workspace', { method: 'PUT', body: { workType, usage } });
      toast.success('Saved');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="max-w-3xl space-y-8">
      <PageHeader
        title="Kind of work"
        description="Tells us which templates, columns and modules to suggest. New spaces start with the columns that fit."
      />
      <section className="space-y-3">
        <h2 className="font-semibold">What kind of work does this workspace do?</h2>
        <WorkTypePicker
          value={workType}
          onChange={(t) => {
            setWorkType(t);
            setUsage([...WORKSPACE_TEMPLATES[t].suggestedUsage]);
          }}
        />
      </section>
      {workType && (
        <section className="space-y-3">
          <h2 className="font-semibold">How does your team plan to use it?</h2>
          <UsagePicker type={workType} value={usage} onChange={setUsage} showAll />
        </section>
      )}
      <section className="bg-card space-y-2 rounded-2xl border p-5">
        <h2 className="font-semibold">Switched on today</h2>
        <ul className="text-muted-foreground flex flex-wrap gap-2 text-sm">
          {org.modules.map((m) => (
            <li key={m} className="bg-muted rounded-full px-2.5 py-1 text-xs font-medium">
              {MODULE_LABEL[m] ?? m}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-xs">
          Saving adds any module your choices need. Nothing is switched off, so no data is hidden.
        </p>
      </section>
      <div className="flex justify-end">
        <Button type="submit" disabled={busy || !workType}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
