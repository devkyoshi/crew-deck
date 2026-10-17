'use client';

import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  Pencil,
  ShieldAlert,
} from 'lucide-react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CorrectionDialog } from '@/components/checkin/correction-dialog';
import { useToday } from '@/components/checkin/use-today';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { TonePill } from '@/components/shared/pastel';
import { useIsAdmin } from '@/components/shell/me-context';
import { LockedButton } from '@/components/plans/locked-button';
import { useHasFeature } from '@/lib/plans';
import { api, qs, type HistoryRow, type Member, type Page } from '@/lib/api';
import { addDaysStr, formatHours, shortDate } from '@/lib/format';
import { LOCATIONS } from '@/lib/locations';

const PAGE_SIZE = 25;
const ALL = 'all';

export default function AttendancePage() {
  const isAdmin = useIsAdmin();
  const today = useToday();
  const end = today.data?.date ?? new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [userId, setUserId] = useState(ALL);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<HistoryRow | null>(null);

  const people = useQuery({
    queryKey: ['members', 'attendance-filter'],
    queryFn: () => api<Page<Member>>(`/members${qs({ pageSize: 100 })}`),
    enabled: isAdmin,
  });

  const range = { from: from || addDaysStr(end, -13), to: to || end };
  const params = {
    scope: 'all',
    userId: userId === ALL ? undefined : userId,
    ...range,
    page,
    pageSize: PAGE_SIZE,
  };
  const query = useQuery({
    queryKey: ['history', 'admin', params],
    queryFn: () => api<Page<HistoryRow>>(`/work-days${qs(params)}`),
    placeholderData: keepPreviousData,
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Admins only"
        description="You need to be a workspace admin to see attendance."
      />
    );
  }

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canExport = useHasFeature('attendance_export');
  const exportHref = `/api/v1/work-days/export${qs({ from: range.from, to: range.to, userId: userId === ALL ? undefined : userId })}`;

  return (
    <>
      <PageHeader
        title="Attendance"
        description="A status log of who worked where and when. It is a team-visibility tool, not a formal attendance record."
        action={
          canExport ? (
            <Button variant="outline" asChild>
              <a href={exportHref} download>
                <Download /> Export CSV
              </a>
            </Button>
          ) : (
            <LockedButton>Export CSV</LockedButton>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="att-person">Person</Label>
          <Select
            value={userId}
            onValueChange={(v) => {
              setUserId(v);
              setPage(1);
            }}
          >
            <SelectTrigger id="att-person" className="w-52" aria-label="Filter by person">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Everyone</SelectItem>
              {people.data?.items.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name ?? p.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="att-from">From</Label>
          <Input
            id="att-from"
            type="date"
            className="w-40"
            value={range.from}
            max={range.to}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="att-to">To</Label>
          <Input
            id="att-to"
            type="date"
            className="w-40"
            value={range.to}
            min={range.from}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {query.isError ? (
        <EmptyState
          icon={ClipboardList}
          title="Could not load attendance"
          description="Check the date range, or try again."
          action={
            <Button variant="outline" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table aria-busy={query.isFetching}>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Day</TableHead>
                <TableHead>Person</TableHead>
                <TableHead>Where</TableHead>
                <TableHead>In</TableHead>
                <TableHead>Out</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Correct</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isPending
                ? Array.from({ length: 6 }, (_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 8 }, (_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-6 w-full max-w-28" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : items.map((h) => {
                    const loc = h.locationType ?? h.plannedLocation;
                    return (
                      <TableRow key={h.id}>
                        <TableCell className="whitespace-nowrap">{shortDate(h.date)}</TableCell>
                        <TableCell>
                          <span className="font-medium">{h.name ?? h.email}</span>
                          <span className="text-muted-foreground block text-xs">{h.timezone}</span>
                        </TableCell>
                        <TableCell>
                          {loc ? (
                            <TonePill tone={LOCATIONS[loc].tone} icon={LOCATIONS[loc].icon}>
                              {LOCATIONS[loc].label}
                              {!h.locationType ? ' (planned)' : ''}
                            </TonePill>
                          ) : (
                            '—'
                          )}
                          {h.siteName && (
                            <span className="text-muted-foreground ml-2 text-xs">{h.siteName}</span>
                          )}
                        </TableCell>
                        <TableCell>{h.checkinLocal ?? '—'}</TableCell>
                        <TableCell>{h.checkoutLocal ?? (h.checkinLocal ? 'open' : '—')}</TableCell>
                        <TableCell>{formatHours(h.hours)}</TableCell>
                        <TableCell>
                          <span className="flex gap-1.5">
                            {h.autoClosed && <TonePill tone="amber">Auto-closed</TonePill>}
                            {h.edited && <TonePill tone="violet">Edited</TonePill>}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Correct ${h.name ?? h.email} on ${shortDate(h.date)}`}
                            onClick={() => setEditing(h)}
                          >
                            <Pencil />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              {!query.isPending && items.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8} className="p-0">
                    <EmptyState
                      icon={ClipboardList}
                      title="Nothing in this range"
                      description="No check-ins or plans were recorded for these dates."
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="text-muted-foreground mt-4 flex items-center justify-between text-sm">
        <span aria-live="polite">
          {query.data ? `${total} ${total === 1 ? 'day' : 'days'}` : ' '}
        </span>
        <div className="flex items-center gap-2">
          <span>
            Page {page} of {pages}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next page"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      {editing && (
        <CorrectionDialog
          open
          onOpenChange={(o) => !o && setEditing(null)}
          day={editing}
          person={{
            userId: editing.userId,
            name: editing.name,
            email: editing.email,
            timezone: editing.timezone,
          }}
          today={end}
        />
      )}
    </>
  );
}
