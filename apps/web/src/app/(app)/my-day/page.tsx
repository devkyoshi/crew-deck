'use client';

import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, ChevronLeft, ChevronRight, ClockAlert, Pencil } from 'lucide-react';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { CheckinPanel } from '@/components/checkin/checkin-panel';
import { CorrectionDialog } from '@/components/checkin/correction-dialog';
import { useToday } from '@/components/checkin/use-today';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { TonePill } from '@/components/shared/pastel';
import { useMe } from '@/components/shell/me-context';
import {
  api,
  ApiError,
  qs,
  type HistoryRow,
  type Location,
  type Page,
  type WeekState,
} from '@/lib/api';
import { addDaysStr, formatHours, shortDate } from '@/lib/format';
import { LOCATIONS, WEEKDAYS } from '@/lib/locations';
import { cn } from '@/lib/utils';

const NONE = 'none';

export default function MyDayPage() {
  const me = useMe();
  const qc = useQueryClient();
  const today = useToday();
  const [anchor, setAnchor] = useState<string | undefined>(undefined);
  const [correcting, setCorrecting] = useState<HistoryRow | null>(null);
  const [adding, setAdding] = useState(false);

  const week = useQuery({
    queryKey: ['me-week', anchor ?? 'now'],
    queryFn: () => api<WeekState>(`/me/week${qs({ date: anchor })}`),
    placeholderData: keepPreviousData,
    enabled: today.data?.enabled !== false,
  });
  const history = useQuery({
    queryKey: ['history', 'me'],
    queryFn: () => api<Page<HistoryRow>>(`/work-days${qs({ pageSize: 14 })}`),
    enabled: today.data?.enabled !== false,
  });

  const plan = useMutation({
    mutationFn: (v: { date: string; location: Location | null }) =>
      api('/me/plan', { method: 'PUT', body: { days: [{ date: v.date, location: v.location }] } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me-week'] });
      qc.invalidateQueries({ queryKey: ['me-today'] });
      qc.invalidateQueries({ queryKey: ['team'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save your plan'),
  });

  if (today.isPending) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading your day">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }
  if (today.isError) {
    return (
      <EmptyState
        icon={ClockAlert}
        title="Could not load your day"
        description="Something went wrong."
        action={
          <Button variant="outline" onClick={() => today.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }
  const t = today.data;
  if (!t.enabled) {
    return (
      <EmptyState
        icon={ClockAlert}
        title="Check-in is switched off"
        description="Your workspace admins have turned check-in off. Ask them if you need it."
      />
    );
  }

  const person = {
    userId: me.user.id,
    name: me.user.name,
    email: me.user.email,
    timezone: t.timezone,
  };
  const weekStart = week.data?.days[0]?.date;
  const days = week.data?.days ?? [];

  return (
    <>
      <PageHeader
        title="My day"
        description={`${new Date(`${t.date}T00:00:00Z`).toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })} · ${t.timezone}`}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Today</CardTitle>
            <CardDescription>
              {t.holiday
                ? `Holiday: ${t.holiday}`
                : t.isWorkday
                  ? `Working hours ${t.settings.workStart} to ${t.settings.workEnd}`
                  : 'Not a working day'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CheckinPanel today={t} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>This week&apos;s plan</CardTitle>
              <CardDescription>
                Plan where you will work. Checking in confirms or overrides the plan.
              </CardDescription>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous week"
                onClick={() => weekStart && setAnchor(addDaysStr(weekStart, -7))}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAnchor(undefined)}
                disabled={!anchor}
              >
                This week
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Next week"
                onClick={() => weekStart && setAnchor(addDaysStr(weekStart, 7))}
              >
                <ChevronRight />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {week.isPending ? (
              <div
                className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7"
                aria-busy="true"
              >
                {Array.from({ length: 7 }, (_, i) => (
                  <Skeleton key={i} className="h-28 rounded-lg" />
                ))}
              </div>
            ) : week.isError ? (
              <EmptyState
                icon={ClockAlert}
                title="Could not load the week"
                description="Something went wrong."
                action={
                  <Button variant="outline" onClick={() => week.refetch()}>
                    Try again
                  </Button>
                }
              />
            ) : (
              <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
                {days.map((d) => {
                  const wd = d.workDay;
                  const actual = wd?.checkinAt ? (wd.locationType as Location | null) : null;
                  const isToday = d.date === week.data.today;
                  return (
                    <li
                      key={d.date}
                      className={cn(
                        'space-y-2 rounded-lg border p-2.5 text-xs',
                        isToday && 'border-primary ring-primary/30 ring-2',
                        !d.isWorkday && 'bg-muted/50',
                      )}
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="font-medium">{WEEKDAYS[d.weekday - 1]}</span>
                        <span className="text-muted-foreground">{d.date.slice(8)}</span>
                      </div>
                      {d.holiday && <TonePill tone="amber">{d.holiday}</TonePill>}
                      {actual ? (
                        <TonePill tone={LOCATIONS[actual].tone} icon={LOCATIONS[actual].icon}>
                          {wd?.checkoutLocal
                            ? `${wd.checkinLocal}–${wd.checkoutLocal}`
                            : `In ${wd?.checkinLocal}`}
                        </TonePill>
                      ) : (
                        <Select
                          value={d.plannedLocation ?? NONE}
                          disabled={d.isPast || plan.isPending}
                          onValueChange={(v) =>
                            plan.mutate({
                              date: d.date,
                              location: v === NONE ? null : (v as Location),
                            })
                          }
                        >
                          <SelectTrigger
                            className="h-8 w-full text-xs"
                            aria-label={`Plan for ${shortDate(d.date)}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Not planned</SelectItem>
                            {(['onsite', 'remote', 'offsite', 'leave'] as const).map((l) => (
                              <SelectItem key={l} value={l}>
                                {LOCATIONS[l].label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Recent days</CardTitle>
            <CardDescription>
              Your last two weeks. Correct a day if something is wrong; a reason is always kept.
            </CardDescription>
          </div>
          <Button variant="outline" onClick={() => setAdding(true)}>
            <CalendarPlus /> Add a missing day
          </Button>
        </CardHeader>
        <CardContent>
          {history.isPending ? (
            <div className="space-y-2" aria-busy="true" aria-label="Loading history">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : history.isError ? (
            <EmptyState
              icon={ClockAlert}
              title="Could not load history"
              description="Something went wrong."
              action={
                <Button variant="outline" onClick={() => history.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : history.data.items.length === 0 ? (
            <EmptyState
              icon={ClockAlert}
              title="No days yet"
              description="Your check-ins will show up here."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Day</TableHead>
                    <TableHead>Where</TableHead>
                    <TableHead>In</TableHead>
                    <TableHead>Out</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Flags</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">Correct</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.data.items.map((h) => {
                    const loc = h.locationType ?? h.plannedLocation;
                    return (
                      <TableRow key={h.id}>
                        <TableCell className="whitespace-nowrap font-medium">
                          {shortDate(h.date)}
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
                            aria-label={`Correct ${shortDate(h.date)}`}
                            onClick={() => setCorrecting(h)}
                          >
                            <Pencil />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <CorrectionDialog
        open={correcting !== null}
        onOpenChange={(o) => !o && setCorrecting(null)}
        day={correcting}
        person={person}
        today={t.date}
      />
      <CorrectionDialog
        open={adding}
        onOpenChange={setAdding}
        day={null}
        person={person}
        today={t.date}
      />
    </>
  );
}
