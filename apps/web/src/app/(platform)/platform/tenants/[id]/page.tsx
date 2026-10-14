'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorView } from '@/components/shared/error-view';
import { Notice } from '@/components/shared/notice';
import { PageHeader } from '@/components/shared/page-header';
import { api, ApiError } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/format';
import { formatLimit, LIMIT_LABEL, type LimitKey } from '@/lib/plans';

interface Detail {
  id: string;
  name: string;
  slug: string;
  domain: string;
  status: 'active' | 'suspended';
  suspendedReason: string | null;
  suspendedAt: string | null;
  createdAt: string;
  createdVia: string;
  domainRestricted: boolean;
  planKey: string | null;
  onTrial: boolean;
  trialEndsAt: string | null;
  limitOverrides: Record<string, number | null>;
  effective: { name: string; limits: Partial<Record<LimitKey, number>>; features: string[] };
  usage: Partial<Record<LimitKey, number>>;
  history: {
    id: string;
    admin: string | null;
    action: string;
    detail: Record<string, unknown> | null;
    at: string;
  }[];
}

const NO_PLAN = '__internal';
const LIMITS: LimitKey[] = [
  'seats',
  'spaces',
  'work_items',
  'crm_records',
  'pipelines',
  'sites',
  'storage_mb',
  'max_attachment_mb',
];
const fail = (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : 'Something went wrong');

export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['platform-tenant', id],
    queryFn: () => api<Detail>(`/platform/tenants/${id}`),
    retry: false,
  });
  const plans = useQuery({
    queryKey: ['platform-plans'],
    queryFn: () => api<{ items: { key: string; name: string }[] }>('/platform/plans'),
  });
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [reason, setReason] = useState('');
  const [trialDays, setTrialDays] = useState('14');
  const refresh = () => qc.invalidateQueries({ queryKey: ['platform-tenant', id] });

  const suspend = useMutation({
    mutationFn: () => api(`/platform/tenants/${id}/suspend`, { body: { reason } }),
    onSuccess: () => {
      toast.success('Workspace suspended');
      setConfirmSuspend(false);
      setReason('');
      return refresh();
    },
    onError: fail,
  });
  const unsuspend = useMutation({
    mutationFn: () => api(`/platform/tenants/${id}/unsuspend`, { method: 'POST', body: {} }),
    onSuccess: () => {
      toast.success('Workspace restored');
      return refresh();
    },
    onError: fail,
  });
  const patch = useMutation({
    mutationFn: (body: object) => api(`/platform/tenants/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      toast.success('Plan updated');
      return refresh();
    },
    onError: fail,
  });
  const impersonate = useMutation({
    mutationFn: () =>
      api<{ url: string }>(`/platform/tenants/${id}/impersonate`, { method: 'POST', body: {} }),
    onSuccess: (r) => window.location.assign(r.url),
    onError: fail,
  });

  if (query.isPending)
    return <Skeleton role="status" aria-label="Loading" className="h-96 w-full rounded-2xl" />;
  if (query.isError) return <ErrorView error={query.error} reset={() => query.refetch()} />;
  const t = query.data;

  return (
    <div className="space-y-6">
      <Link
        href="/platform"
        className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden /> All workspaces
      </Link>
      <PageHeader
        title={t.name}
        description={`${t.slug} · ${t.domain} · created ${formatDate(t.createdAt)} (${t.createdVia})`}
        action={
          <>
            <Button
              variant="outline"
              disabled={t.status === 'suspended' || impersonate.isPending}
              onClick={() => impersonate.mutate()}
            >
              <Eye className="size-4" aria-hidden /> Open as owner (read-only)
            </Button>
            {t.status === 'suspended' ? (
              <Button onClick={() => unsuspend.mutate()} disabled={unsuspend.isPending}>
                Unsuspend
              </Button>
            ) : (
              <Button variant="destructive" onClick={() => setConfirmSuspend(true)}>
                Suspend
              </Button>
            )}
          </>
        }
      />

      {t.status === 'suspended' && (
        <Notice variant="error">
          Suspended {t.suspendedAt ? timeAgo(t.suspendedAt) : ''}. Reason:{' '}
          {t.suspendedReason ?? 'none given'}. Nobody can sign in, and open sessions have ended.
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="plan" className="bg-card space-y-4 rounded-2xl border p-5">
          <h2 id="plan" className="font-semibold">
            Plan
          </h2>
          <p className="text-sm">
            On <strong>{t.effective.name}</strong>
            {t.onTrial && t.trialEndsAt ? `, trial ends ${formatDate(t.trialEndsAt)}` : ''}.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="plan-select">Change plan</Label>
            <Select
              value={t.planKey ?? NO_PLAN}
              onValueChange={(v) => patch.mutate({ planKey: v === NO_PLAN ? null : v })}
              disabled={patch.isPending}
            >
              <SelectTrigger id="plan-select" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PLAN}>Internal (no limits)</SelectItem>
                {plans.data?.items.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trial-days">Start or extend a trial (days from today)</Label>
            <div className="flex gap-2">
              <Input
                id="trial-days"
                type="number"
                min={0}
                max={365}
                className="w-28"
                value={trialDays}
                onChange={(e) => setTrialDays(e.target.value)}
              />
              <Button
                variant="outline"
                disabled={patch.isPending}
                onClick={() =>
                  patch.mutate({
                    planKey: t.planKey ?? 'business',
                    trialDays: Math.max(0, Math.round(Number(trialDays) || 0)),
                  })
                }
              >
                Set trial
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              At the end the workspace moves to Free. Use 0 to end a trial now and keep the chosen
              plan.
            </p>
          </div>
        </section>

        <section aria-labelledby="usage" className="bg-card space-y-3 rounded-2xl border p-5">
          <h2 id="usage" className="font-semibold">
            Usage
          </h2>
          <dl className="divide-y text-sm">
            {LIMITS.map((k) => (
              <div key={k} className="flex justify-between py-2">
                <dt className="text-muted-foreground">{LIMIT_LABEL[k]}</dt>
                <dd className="tabular-nums">
                  {t.usage[k] ?? 0} of {formatLimit(k, t.effective.limits[k])}
                  {t.limitOverrides[k] !== undefined ? ' (custom)' : ''}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <section aria-labelledby="history" className="bg-card space-y-3 rounded-2xl border p-5">
        <h2 id="history" className="font-semibold">
          Platform activity
        </h2>
        {t.history.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {t.history.map((h) => (
              <li key={h.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">
                    {h.action.replace('platform.', '').replaceAll('_', ' ')}
                  </span>
                  <span className="text-muted-foreground"> by {h.admin ?? 'unknown'}</span>
                </span>
                <span className="text-muted-foreground">{timeAgo(h.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AlertDialog open={confirmSuspend} onOpenChange={setConfirmSuspend}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspend {t.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Nobody in this workspace can sign in, and sessions that are open stop working. Their
              data is kept and you can restore access at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="suspend-reason">Reason (shown in the workspace's audit log)</Label>
            <Input
              id="suspend-reason"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => suspend.mutate()}>
              Suspend workspace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
