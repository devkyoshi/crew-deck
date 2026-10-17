'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { toast } from '@/lib/toast';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorView } from '@/components/shared/error-view';
import { PageHeader } from '@/components/shared/page-header';
import { api, ApiError } from '@/lib/api';
import { openCrmChannel } from '@/lib/messaging-admin-api';
import { money, recordHref, useCrmAccess, type CrmRecordType, type DealDetail } from '@/lib/crm';
import { CrmGate } from './crm-bits';
import { ConvertDialog } from './convert-dialog';
import { ENTITIES } from './entities';
import { DealStatusPill } from './pills';
import { RecordDialog, toBody, type Values } from './record-dialog';
import { Timeline } from './timeline';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function RecordDetail({ type, id }: { type: CrmRecordType; id: string }) {
  return (
    <CrmGate>
      <DetailInner type={type} id={id} />
    </CrmGate>
  );
}

function RelatedDeals({
  deals,
}: {
  deals: {
    id: string;
    title: string;
    value: number;
    currency: string;
    status: any;
    stageName: string;
  }[];
}) {
  if (!deals.length) return null;
  return (
    <section aria-labelledby="related-deals" className="bg-card space-y-2 rounded-lg border p-4">
      <h2 id="related-deals" className="text-sm font-semibold">
        Deals
      </h2>
      <ul className="divide-y">
        {deals.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 py-2">
            <Link href={recordHref('deal', d.id)} className="truncate font-medium hover:underline">
              {d.title}
            </Link>
            <span className="text-muted-foreground flex shrink-0 items-center gap-2 text-sm">
              {d.stageName} · {money(d.value, d.currency)} <DealStatusPill status={d.status} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StageControl({ deal }: { deal: DealDetail }) {
  const qc = useQueryClient();
  const canEdit = useCrmAccess().data?.canEdit ?? false;
  const move = useMutation({
    mutationFn: (stageId: string) =>
      api(`/crm/deals/${deal.id}/move`, { method: 'POST', body: { stageId } }),
    onSuccess: () => {
      toast.success('Deal moved');
      return qc.invalidateQueries({ queryKey: ['crm'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not move the deal'),
  });
  return (
    <div className="bg-card flex flex-wrap items-center gap-3 rounded-lg border p-4">
      <label htmlFor="deal-stage" className="text-sm font-medium">
        Stage
      </label>
      <Select
        value={deal.stageId}
        onValueChange={(v) => move.mutate(v)}
        disabled={!canEdit || move.isPending}
      >
        <SelectTrigger id="deal-stage" className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {deal.stages.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DealStatusPill status={deal.status} />
      {deal.closedAt && (
        <span className="text-muted-foreground text-sm">
          Closed {new Date(deal.closedAt).toLocaleDateString('en', { dateStyle: 'medium' })}
        </span>
      )}
    </div>
  );
}

function DetailInner({ type, id }: { type: CrmRecordType; id: string }) {
  const def = ENTITIES[type];
  const router = useRouter();
  const qc = useQueryClient();
  const access = useCrmAccess().data;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const key = ['crm', def.plural, 'detail', id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<any>(`/crm/${def.plural}/${id}`),
    retry: false,
  });

  // A private channel for this record that hears about stage changes and new activities.
  const openChat = useMutation({
    mutationFn: () => openCrmChannel(def.plural === 'deals' ? 'deals' : 'companies', id),
    onSuccess: ({ channel }) => router.push(`/messages/${channel.id}`),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not open the channel'),
  });

  const remove = useMutation({
    mutationFn: () => api(`/crm/${def.plural}/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success(`${def.singular[0]!.toUpperCase()}${def.singular.slice(1)} deleted`);
      await qc.invalidateQueries({ queryKey: ['crm'] });
      router.push(`/crm/${def.plural}`);
    },
    onError: (e) => {
      setConfirmDelete(false);
      toast.error(e instanceof ApiError ? e.message : 'Could not delete');
    },
  });

  if (query.isPending)
    return <Skeleton role="status" aria-label="Loading" className="h-80 w-full rounded-lg" />;
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return (
        <div className="py-16 text-center">
          <h1 className="text-xl font-semibold">
            {def.singular[0]!.toUpperCase() + def.singular.slice(1)} not found
          </h1>
          <p className="text-muted-foreground mt-1">It may have been deleted.</p>
          <Button asChild className="mt-4">
            <Link href={`/crm/${def.plural}`}>Back to {def.plural}</Link>
          </Button>
        </div>
      );
    }
    return <ErrorView error={query.error} reset={() => query.refetch()} />;
  }

  const r = query.data;
  const fieldKeys = def.fields.map((f) => f.key);
  const initial: Values = Object.fromEntries(
    def.fields.map((f) => [f.key, r[f.key] ?? (f.type === 'tags' ? [] : null)]),
  );
  if ('labelKey' in (def.fields.find((f) => f.type === 'company') ?? {}))
    initial.companyName = r.companyName;
  const converted = type === 'lead' && r.convertedAt;

  return (
    <div>
      <PageHeader
        title={r[def.nameKey]}
        description={
          type === 'deal'
            ? `${money(r.value, r.currency)} · ${r.companyName ?? 'No company'}`
            : undefined
        }
        action={
          <>
            {type === 'lead' && access?.canEdit && !converted && <ConvertDialog lead={r} />}
            {(type === 'deal' || type === 'company') && access?.canEdit && (
              <Button variant="outline" loading={openChat.isPending} onClick={() => openChat.mutate()}>
                <MessageSquare className="size-4" aria-hidden /> Open channel
              </Button>
            )}
            {access?.canEdit && (
              <RecordDialog
                title={`Edit ${def.singular}`}
                fields={def.fields}
                initial={initial}
                submitLabel="Save changes"
                successMessage="Saved"
                trigger={
                  <Button variant="outline">
                    <Pencil className="size-4" aria-hidden /> Edit
                  </Button>
                }
                onSubmit={async (v) => {
                  await api(`/crm/${def.plural}/${id}`, {
                    method: 'PATCH',
                    body: toBody(v, fieldKeys),
                  });
                  await qc.invalidateQueries({ queryKey: ['crm'] });
                }}
              />
            )}
            {access?.canAdmin && (
              <Button variant="outline" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" aria-hidden /> Delete
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="space-y-4">
          {type === 'deal' && <StageControl deal={r} />}
          <section aria-labelledby="details" className="bg-card rounded-lg border p-4">
            <h2 id="details" className="mb-3 text-sm font-semibold">
              Details
            </h2>
            <dl className="space-y-3 text-sm">
              {def.facts.map((f) => (
                <div key={f.label} className="grid grid-cols-[7rem_1fr] gap-2">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="min-w-0 break-words">{f.value(r)}</dd>
                </div>
              ))}
            </dl>
          </section>
          {converted && (
            <section
              aria-labelledby="converted"
              className="bg-card space-y-1 rounded-lg border p-4 text-sm"
            >
              <h2 id="converted" className="font-semibold">
                Converted
              </h2>
              {r.convertedCompanyId && (
                <p>
                  <Link
                    className="text-primary hover:underline"
                    href={recordHref('company', r.convertedCompanyId)}
                  >
                    View company
                  </Link>
                </p>
              )}
              {r.convertedContactId && (
                <p>
                  <Link
                    className="text-primary hover:underline"
                    href={recordHref('contact', r.convertedContactId)}
                  >
                    View contact
                  </Link>
                </p>
              )}
              {r.convertedDealId && (
                <p>
                  <Link
                    className="text-primary hover:underline"
                    href={recordHref('deal', r.convertedDealId)}
                  >
                    View deal
                  </Link>
                </p>
              )}
            </section>
          )}
          {type === 'company' && r.contacts?.length > 0 && (
            <section
              aria-labelledby="related-contacts"
              className="bg-card space-y-2 rounded-lg border p-4"
            >
              <h2 id="related-contacts" className="text-sm font-semibold">
                Contacts
              </h2>
              <ul className="space-y-1 text-sm">
                {r.contacts.map((c: any) => (
                  <li key={c.id}>
                    <Link className="hover:underline" href={recordHref('contact', c.id)}>
                      {c.name}
                    </Link>
                    {c.jobTitle && <span className="text-muted-foreground"> · {c.jobTitle}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(type === 'company' || type === 'contact') && <RelatedDeals deals={r.deals ?? []} />}
        </div>
        <section aria-label="Activity and notes" className="bg-card rounded-lg border p-4">
          <Timeline linkedType={type} linkedId={id} />
        </section>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {r[def.nameKey]}?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed from lists and search. This is recorded in the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
