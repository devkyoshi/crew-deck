'use client';

import { useHydrated } from '@/components/checkin/use-hydrated';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ErrorView } from '@/components/shared/error-view';
import { PageHeader } from '@/components/shared/page-header';
import { api, ApiError } from '@/lib/api';
import { useCrmAccess, type Pipeline, type Stage } from '@/lib/crm';
import { cn } from '@/lib/utils';

const fail = (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : 'Something went wrong');

function StageRow({
  stage,
  index,
  last,
  pipeline,
  onChanged,
}: {
  stage: Stage;
  index: number;
  last: number;
  pipeline: Pipeline;
  onChanged: () => void;
}) {
  const [name, setName] = useState(stage.name);
  const [prob, setProb] = useState(String(stage.probability));
  const patch = useMutation({
    mutationFn: (body: object) => api(`/crm/stages/${stage.id}`, { method: 'PATCH', body }),
    onSuccess: onChanged,
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => api(`/crm/stages/${stage.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Stage removed');
      onChanged();
    },
    onError: fail,
  });
  const reorder = useMutation({
    mutationFn: (to: number) => {
      const ids = pipeline.stages.map((s) => s.id);
      ids.splice(to, 0, ids.splice(index, 1)[0]!);
      return api(`/crm/pipelines/${pipeline.id}/stage-order`, {
        method: 'PUT',
        body: { stageIds: ids },
      });
    },
    onSuccess: onChanged,
    onError: fail,
  });
  const commit = () => {
    const p = Math.min(100, Math.max(0, Math.round(Number(prob) || 0)));
    setProb(String(p));
    if (name.trim() && (name.trim() !== stage.name || p !== stage.probability))
      patch.mutate({ name: name.trim(), probability: p });
  };
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border p-2">
      <div className="flex">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={index === 0 || reorder.isPending}
          onClick={() => reorder.mutate(index - 1)}
          aria-label={`Move ${stage.name} up`}
        >
          <ArrowUp className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={index === last || reorder.isPending}
          onClick={() => reorder.mutate(index + 1)}
          aria-label={`Move ${stage.name} down`}
        >
          <ArrowDown className="size-4" aria-hidden />
        </Button>
      </div>
      <Input
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        aria-label={`Name of stage ${index + 1}`}
        className="w-44"
      />
      <div className="flex items-center gap-1.5">
        <Input
          value={prob}
          inputMode="numeric"
          onChange={(e) => setProb(e.target.value)}
          onBlur={commit}
          aria-label={`Win probability of ${stage.name}, percent`}
          className="w-20"
        />
        <span className="text-muted-foreground text-sm">%</span>
      </div>
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-xs',
          stage.isWon && 'bg-emerald-100 text-emerald-800',
          stage.isLost && 'bg-rose-100 text-rose-800',
          !stage.isWon && !stage.isLost && 'bg-secondary',
        )}
      >
        {stage.isWon ? 'Counts as won' : stage.isLost ? 'Counts as lost' : 'Open stage'}
      </span>
      <span className="text-muted-foreground text-xs">{stage.dealCount} deals</span>
      <Button
        variant="ghost"
        size="icon"
        className="ml-auto size-8"
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
        aria-label={`Delete stage ${stage.name}`}
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </li>
  );
}

function PipelineCard({ pipeline, onChanged }: { pipeline: Pipeline; onChanged: () => void }) {
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: () =>
      api(`/crm/pipelines/${pipeline.id}/stages`, {
        method: 'POST',
        body: { name: name.trim(), probability: 50 },
      }),
    onSuccess: () => {
      setName('');
      onChanged();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => api(`/crm/pipelines/${pipeline.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Pipeline deleted');
      onChanged();
    },
    onError: fail,
  });
  return (
    <section
      aria-labelledby={`pl-${pipeline.id}`}
      className="bg-card space-y-3 rounded-2xl border p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id={`pl-${pipeline.id}`} className="font-semibold">
          {pipeline.name}{' '}
          {pipeline.isDefault && (
            <span className="text-muted-foreground text-xs font-normal">(default)</span>
          )}
        </h2>
        {!pipeline.isDefault && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            Delete pipeline
          </Button>
        )}
      </div>
      <ol className="space-y-2">
        {pipeline.stages.map((s, i) => (
          <StageRow
            key={s.id}
            stage={s}
            index={i}
            last={pipeline.stages.length - 1}
            pipeline={pipeline}
            onChanged={onChanged}
          />
        ))}
      </ol>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <Label htmlFor={`new-stage-${pipeline.id}`} className="sr-only">
          New stage name
        </Label>
        <Input
          id={`new-stage-${pipeline.id}`}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder="New stage name"
          className="max-w-xs"
        />
        <Button type="submit" disabled={add.isPending || !name.trim()}>
          <Plus className="size-4" aria-hidden /> Add stage
        </Button>
      </form>
    </section>
  );
}

export function CrmSettings() {
  const qc = useQueryClient();
  const access = useCrmAccess();
  // Match the server HTML until hydrated (the sidebar may have fetched CRM access already).
  const hydrated = useHydrated();
  const [newPipeline, setNewPipeline] = useState('');
  const enabled = access.data?.enabled ?? true;
  const pipelines = useQuery({
    queryKey: ['crm', 'pipelines', 'settings'],
    queryFn: () => api<{ items: Pipeline[] }>('/crm/pipelines'),
    enabled: access.data?.canAdmin && enabled,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['crm'] });
  const toggle = useMutation({
    mutationFn: (on: boolean) => api('/crm/settings', { method: 'PUT', body: { enabled: on } }),
    onSuccess: async () => {
      toast.success('CRM setting saved');
      await qc.invalidateQueries({ queryKey: ['crm-access'] });
      await refresh();
    },
    onError: fail,
  });
  const createPipeline = useMutation({
    mutationFn: () => api('/crm/pipelines', { method: 'POST', body: { name: newPipeline.trim() } }),
    onSuccess: () => {
      setNewPipeline('');
      void refresh();
    },
    onError: fail,
  });

  if (!hydrated || access.isPending)
    return <Skeleton role="status" aria-label="Loading" className="h-64 w-full rounded-2xl" />;
  if (access.isError) return <ErrorView error={access.error} reset={() => access.refetch()} />;

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="CRM"
        description="Switch the CRM on or off and shape your sales pipelines."
      />
      <section className="bg-card flex items-center justify-between gap-4 rounded-2xl border p-4">
        <div>
          <Label htmlFor="crm-enabled" className="text-base">
            CRM module
          </Label>
          <p className="text-muted-foreground text-sm">
            When off, the CRM is hidden from everyone. Your data is kept.
          </p>
        </div>
        <Switch
          id="crm-enabled"
          checked={enabled}
          disabled={toggle.isPending}
          onCheckedChange={(v) => toggle.mutate(v)}
        />
      </section>
      {enabled && (
        <>
          {pipelines.isPending && (
            <Skeleton
              role="status"
              aria-label="Loading pipelines"
              className="h-48 w-full rounded-2xl"
            />
          )}
          {pipelines.isError && (
            <ErrorView error={pipelines.error} reset={() => pipelines.refetch()} />
          )}
          {pipelines.data?.items.map((p) => (
            <PipelineCard key={p.id} pipeline={p} onChanged={refresh} />
          ))}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newPipeline.trim()) createPipeline.mutate();
            }}
          >
            <Label htmlFor="new-pipeline" className="sr-only">
              New pipeline name
            </Label>
            <Input
              id="new-pipeline"
              value={newPipeline}
              maxLength={80}
              onChange={(e) => setNewPipeline(e.target.value)}
              placeholder="New pipeline name"
              className="max-w-xs"
            />
            <Button
              type="submit"
              variant="outline"
              disabled={createPipeline.isPending || !newPipeline.trim()}
            >
              <Plus className="size-4" aria-hidden /> Add pipeline
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
