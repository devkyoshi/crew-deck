'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ErrorView } from '@/components/shared/error-view';
import { PageHeader } from '@/components/shared/page-header';
import { api, ApiError } from '@/lib/api';

interface Settings {
  blockFreeEmailDomains: boolean;
  signupsEnabled: boolean;
  trialDays: number;
}

export default function PlatformSettingsPage() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['platform-settings'],
    queryFn: () => api<Settings>('/platform/settings'),
  });
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);
  const save = useMutation({
    mutationFn: (s: Settings) => api<Settings>('/platform/settings', { method: 'PUT', body: s }),
    onSuccess: async () => {
      toast.success('Settings saved');
      await qc.invalidateQueries({ queryKey: ['platform-settings'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save'),
  });

  if (query.isError) return <ErrorView error={query.error} reset={() => query.refetch()} />;
  if (!form)
    return <Skeleton role="status" aria-label="Loading" className="h-64 w-full rounded-lg" />;

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title="Platform settings"
        description="Rules for sign-up across every workspace."
      />
      <section className="bg-card flex items-center justify-between gap-4 rounded-lg border p-5">
        <div>
          <Label htmlFor="signups" className="text-base">
            Open sign-ups
          </Label>
          <p className="text-muted-foreground text-sm">
            When off, the public sign-up page asks people to contact you instead.
          </p>
        </div>
        <Switch
          id="signups"
          checked={form.signupsEnabled}
          onCheckedChange={(v) => setForm({ ...form, signupsEnabled: v })}
        />
      </section>
      <section className="bg-card flex items-center justify-between gap-4 rounded-lg border p-5">
        <div>
          <Label htmlFor="free-mail" className="text-base">
            Block free email providers
          </Label>
          <p className="text-muted-foreground text-sm">
            When on, people must sign up with a company email, not Gmail, Outlook or similar. Off by
            default.
          </p>
        </div>
        <Switch
          id="free-mail"
          checked={form.blockFreeEmailDomains}
          onCheckedChange={(v) => setForm({ ...form, blockFreeEmailDomains: v })}
        />
      </section>
      <section className="bg-card space-y-2 rounded-lg border p-5">
        <Label htmlFor="trial" className="text-base">
          Trial length (days)
        </Label>
        <p className="text-muted-foreground text-sm">
          New sign-ups get the Business plan for this long, then move to Free. Use 0 for no trial.
        </p>
        <Input
          id="trial"
          type="number"
          min={0}
          max={90}
          className="w-28"
          value={form.trialDays}
          onChange={(e) =>
            setForm({
              ...form,
              trialDays: Math.min(90, Math.max(0, Math.round(Number(e.target.value) || 0))),
            })
          }
        />
      </section>
      <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
        {save.isPending ? 'Saving…' : 'Save settings'}
      </Button>
    </div>
  );
}
