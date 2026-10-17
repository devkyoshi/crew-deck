'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, Plus, Search, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorView } from '@/components/shared/error-view';
import { PageHeader } from '@/components/shared/page-header';
import { api, qs, type Page } from '@/lib/api';
import { LEAD_STATUS_LABEL, useCrmAccess, type CrmRecordType } from '@/lib/crm';
import { CrmGate, useDebounced } from './crm-bits';
import { ENTITIES } from './entities';
import { ImportDialog } from './import-dialog';
import { LockedButton } from '@/components/plans/locked-button';
import { useHasFeature } from '@/lib/plans';
import { RecordDialog, toBody, type Values } from './record-dialog';

const PAGE_SIZE = 20;

export function RecordList({ type, bare = false }: { type: CrmRecordType; bare?: boolean }) {
  return (
    <CrmGate>
      <ListInner type={type} bare={bare} />
    </CrmGate>
  );
}

function ListInner({ type, bare }: { type: CrmRecordType; bare: boolean }) {
  const def = ENTITIES[type];
  const access = useCrmAccess().data;
  const canIo = useHasFeature('crm_io');
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [status, setStatus] = useState('all');
  const [mine, setMine] = useState<'all' | 'open'>('all');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [q, status, mine]);

  const params = {
    q,
    status: type === 'lead' && status !== 'all' ? status : undefined,
    converted: type === 'lead' && mine === 'open' ? 'false' : undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const query = useQuery({
    queryKey: ['crm', def.plural, params],
    queryFn: () => api<Page<Record<string, unknown>>>(`/crm/${def.plural}${qs(params)}`),
    placeholderData: keepPreviousData,
  });

  const fieldKeys = def.fields.map((f) => f.key);
  const filtered = Boolean(q) || status !== 'all' || mine !== 'all';
  const pages = Math.max(1, Math.ceil((query.data?.total ?? 0) / PAGE_SIZE));

  const create = (
    <RecordDialog
      title={`New ${def.singular}`}
      fields={def.fields}
      initial={def.blank}
      submitLabel={`Create ${def.singular}`}
      successMessage={`${def.singular[0]!.toUpperCase()}${def.singular.slice(1)} created`}
      trigger={
        <Button>
          <Plus className="size-4" aria-hidden /> New {def.singular}
        </Button>
      }
      onSubmit={async (v: Values) => {
        await api(`/crm/${def.plural}`, { method: 'POST', body: toBody(v, fieldKeys) });
        await qc.invalidateQueries({ queryKey: ['crm'] });
      }}
    />
  );

  let action: ReactNode = null;
  if (type !== 'deal' && (access?.canEdit || access?.canAdmin)) {
    action = (
      <>
        {access.canAdmin &&
          (canIo ? (
            <>
              <ImportDialog type={def.plural as 'companies' | 'contacts' | 'leads'} />
              <Button variant="outline" asChild>
                <a href={`/api/v1/crm/export/${def.plural}`} download>
                  <Download className="size-4" aria-hidden /> Export
                </a>
              </Button>
            </>
          ) : (
            <LockedButton>Import and export</LockedButton>
          ))}
        {access.canEdit && create}
      </>
    );
  }

  return (
    <div>
      {!bare && (
        <PageHeader
          title={def.title}
          description={`${query.data?.total ?? '…'} ${def.plural} in this workspace`}
          action={action}
        />
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-2.5 left-3 size-4"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={def.searchPlaceholder}
            aria-label={def.searchPlaceholder}
            className="pl-9"
          />
        </div>
        {type === 'lead' && (
          <>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {Object.entries(LEAD_STATUS_LABEL).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={mine} onValueChange={(v) => setMine(v as 'all' | 'open')}>
              <SelectTrigger className="w-44" aria-label="Filter by conversion">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Converted and not</SelectItem>
                <SelectItem value="open">Not converted yet</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
      </div>

      {query.isError ? (
        <ErrorView error={query.error} reset={() => query.refetch()} />
      ) : query.isPending ? (
        <div role="status" aria-label="Loading" className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : query.data.items.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title={`No ${def.plural} match`}
            description="Try a different search or clear the filters."
          />
        ) : (
          <EmptyState
            icon={Plus}
            title={`No ${def.plural} yet`}
            description={
              access?.canEdit
                ? `Add your first ${def.singular}, or import a CSV.`
                : `Nothing here yet.`
            }
          />
        )
      ) : (
        <>
          <div className="bg-card rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  {def.columns.map((c) => (
                    <TableHead key={c.header} className={c.className}>
                      {c.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.map((r) => (
                  <TableRow key={r.id as string}>
                    {def.columns.map((c) => (
                      <TableCell key={c.header} className={c.className}>
                        {c.cell(r)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
