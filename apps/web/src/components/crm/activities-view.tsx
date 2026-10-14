'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorView } from '@/components/shared/error-view';
import { PageHeader } from '@/components/shared/page-header';
import { useMe } from '@/components/shell/me-context';
import { api, qs, type Page } from '@/lib/api';
import { recordHref, useCrmAccess, type Activity } from '@/lib/crm';
import { CrmGate } from './crm-bits';
import { ActivityForm, ActivityRow } from './timeline';

const PAGE_SIZE = 20;

export function ActivitiesView() {
  return (
    <CrmGate>
      <Inner />
    </CrmGate>
  );
}

function Inner() {
  const qc = useQueryClient();
  const me = useMe();
  const canEdit = useCrmAccess().data?.canEdit ?? false;
  const [status, setStatus] = useState('open');
  const [who, setWho] = useState<'mine' | 'all'>('mine');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  useEffect(() => setPage(1), [status, who]);
  const params = {
    status: status === 'all' ? undefined : status,
    assigneeId: who === 'mine' ? me.user.id : undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const query = useQuery({
    queryKey: ['crm', 'activities', 'all', params],
    queryFn: () => api<Page<Activity>>(`/crm/activities${qs(params)}`),
    placeholderData: keepPreviousData,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['crm'] });
  const pages = Math.max(1, Math.ceil((query.data?.total ?? 0) / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Activities"
        description="Calls, meetings, emails and tasks across the CRM."
        action={
          canEdit && (
            <Dialog open={adding} onOpenChange={setAdding}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="size-4" aria-hidden /> New activity
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New activity</DialogTitle>
                  <DialogDescription>
                    Link it to a record from that record’s page.
                  </DialogDescription>
                </DialogHeader>
                <ActivityForm
                  onDone={() => {
                    setAdding(false);
                    void refresh();
                  }}
                />
              </DialogContent>
            </Dialog>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="done">Done</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Select value={who} onValueChange={(v) => setWho(v as 'mine' | 'all')}>
          <SelectTrigger className="w-40" aria-label="Filter by person">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mine">Assigned to me</SelectItem>
            <SelectItem value="all">Everyone</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {query.isError ? (
        <ErrorView error={query.error} reset={() => query.refetch()} />
      ) : query.isPending ? (
        <Skeleton role="status" aria-label="Loading" className="h-48 w-full rounded-2xl" />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Nothing here"
          description="No activities match these filters."
        />
      ) : (
        <>
          <ul className="space-y-2">
            {query.data.items.map((a) => (
              <ActivityRow
                key={a.id}
                a={a}
                canEdit={canEdit}
                onChanged={refresh}
                footer={
                  a.linkedType && a.linkedId ? (
                    <Link
                      className="text-primary text-xs hover:underline"
                      href={recordHref(a.linkedType, a.linkedId)}
                    >
                      View {a.linkedType}
                    </Link>
                  ) : undefined
                }
              />
            ))}
          </ul>
          <nav aria-label="Pagination" className="flex items-center justify-between pt-4">
            <p className="text-muted-foreground text-sm">
              Page {page} of {pages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="size-4" aria-hidden /> Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
