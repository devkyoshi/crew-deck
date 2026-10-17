'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { toast } from '@/lib/toast';
import { suggestedUsageFor, usageNeedsCrm, workTypesOf, type WorkType } from '@crew-deck/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { SaveIndicator, useSaveState } from '@/components/shared/save-indicator';
import { useIsAdmin, useMe } from '@/components/shell/me-context';
import { Button } from '@/components/ui/button';
import { UsagePicker, WorkTypeMultiPicker } from '@/components/workspace/work-type-picker';
import { api, ApiError } from '@/lib/api';

/** What the workspace is for. Its usage choices decide which features the team sees. */
export default function WorkspacePurposePage() {
  const isAdmin = useIsAdmin();
  const { org } = useMe();
  const router = useRouter();
  const [workTypes, setWorkTypes] = useState<WorkType[]>(workTypesOf(org.workType, org.workTypes));
  // A workspace that already has the CRM keeps it: tick "Track leads and deals" for it, so saving
  // does not switch the CRM off.
  const [usage, setUsage] = useState<string[]>(() => {
    const saved = org.usage ?? [];
    return org.modules.includes('crm') && !usageNeedsCrm(saved) ? [...saved, 'track_leads'] : saved;
  });
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const saveState = useSaveState();

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
    if (workTypes.length === 0) return toast.error('Choose at least one kind of work first');
    setBusy(true);
    saveState.markSaving();
    try {
      await api('/settings/workspace', { method: 'PUT', body: { workTypes, usage } });
      saveState.markSaved();
      toast.success('Workspace settings saved');
      await qc.invalidateQueries({ queryKey: ['crm-access'] });
      router.refresh();
    } catch (err) {
      saveState.markFailed();
      toast.error(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="max-w-3xl space-y-8">
      <PageHeader
        title="Kind of work"
        description="Tells us which templates and columns to suggest, and which features your team sees. New spaces start with the columns that fit."
      />
      <section className="space-y-3">
        <h2 className="font-semibold">What kind of work does this workspace do? Pick all that apply.</h2>
        <WorkTypeMultiPicker
          value={workTypes}
          onChange={(types) => {
            saveState.markDirty();
            setWorkTypes(types);
            setUsage(suggestedUsageFor(types));
          }}
        />
      </section>
      {workTypes.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold">How does your team plan to use it?</h2>
          <UsagePicker
            types={workTypes}
            value={usage}
            onChange={(v) => {
              saveState.markDirty();
              setUsage(v);
            }}
            showAll
          />
        </section>
      )}
      <div className="flex items-center justify-end gap-4">
        <SaveIndicator state={saveState.state} />
        <Button type="submit" disabled={busy || workTypes.length === 0}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
