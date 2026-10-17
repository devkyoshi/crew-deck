'use client';

import { Fragment, useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileClock,
  ShieldAlert,
  X,
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
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { TonePill } from '@/components/shared/pastel';
import { useIsAdmin } from '@/components/shell/me-context';
import { api, qs, type AuditEntry, type Member, type Page } from '@/lib/api';
import { AUDIT_LABELS, auditLabel, auditSummary } from '@/lib/audit-labels';

const PAGE_SIZE = 20;
const ALL = 'all';
const TARGET_TONE = {
  member: 'blue',
  invitation: 'amber',
  group: 'violet',
  space: 'green',
} as const;

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function AuditLogPage() {
  const isAdmin = useIsAdmin();
  const [actor, setActor] = useState(ALL);
  const [action, setAction] = useState(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => setPage(1), [actor, action, from, to]);

  // The workspace is small enough for a plain list of people to filter by.
  const people = useQuery({
    queryKey: ['audit-actors'],
    queryFn: () => api<Page<Member>>(`/members${qs({ pageSize: 100 })}`),
    enabled: isAdmin,
  });

  const params = {
    actor: actor === ALL ? undefined : actor,
    action: action === ALL ? undefined : action,
    from: from || undefined,
    to: to || undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const query = useQuery({
    queryKey: ['audit', 'org', params],
    queryFn: () => api<Page<AuditEntry>>(`/audit-logs${qs(params)}`),
    placeholderData: keepPreviousData,
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Admins only"
        description="You need to be a workspace admin to read the audit log."
      />
    );
  }

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = actor !== ALL || action !== ALL || from || to;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every invite, role change, group and space change, newest first."
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="audit-actor">Who</Label>
          <Select value={actor} onValueChange={setActor}>
            <SelectTrigger id="audit-actor" className="w-48" aria-label="Filter by person">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Anyone</SelectItem>
              {people.data?.items.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name ?? p.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-action">What</Label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger id="audit-action" className="w-56" aria-label="Filter by action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any action</SelectItem>
              {Object.entries(AUDIT_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label[0]!.toUpperCase() + label.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-from">From</Label>
          <Input
            id="audit-from"
            type="date"
            className="w-40"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-to">To</Label>
          <Input
            id="audit-to"
            type="date"
            className="w-40"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setActor(ALL);
              setAction(ALL);
              setFrom('');
              setTo('');
            }}
          >
            <X /> Clear filters
          </Button>
        )}
      </div>

      {query.isError ? (
        <EmptyState
          icon={FileClock}
          title="Could not load the audit log"
          description="Something went wrong."
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
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>What</TableHead>
                <TableHead>On</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Details</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isPending
                ? Array.from({ length: 6 }, (_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }, (_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-6 w-full max-w-40" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : items.map((e) => {
                    const summary = auditSummary(e);
                    const expanded = open === e.id;
                    return (
                      <Fragment key={e.id}>
                        <TableRow>
                          <TableCell className="text-muted-foreground whitespace-nowrap">
                            {fmt(e.createdAt)}
                          </TableCell>
                          <TableCell>{e.actorName ?? e.actorEmail ?? 'System'}</TableCell>
                          <TableCell>
                            {auditLabel(e.action)}
                            {summary && (
                              <span className="text-muted-foreground block max-w-md truncate text-xs">
                                {summary}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <TonePill
                              tone={TARGET_TONE[e.targetType as keyof typeof TARGET_TONE] ?? 'blue'}
                            >
                              {e.targetType}
                            </TonePill>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={expanded ? 'Hide details' : 'Show details'}
                              aria-expanded={expanded}
                              onClick={() => setOpen(expanded ? null : e.id)}
                            >
                              {expanded ? <ChevronUp /> : <ChevronDown />}
                            </Button>
                          </TableCell>
                        </TableRow>
                        {expanded && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={5}>
                              <div className="grid gap-3 text-xs sm:grid-cols-2">
                                <div>
                                  <div className="text-muted-foreground mb-1 font-medium">
                                    Before
                                  </div>
                                  <pre className="bg-background overflow-x-auto rounded-lg border p-2">
                                    {e.before ? JSON.stringify(e.before, null, 2) : '—'}
                                  </pre>
                                </div>
                                <div>
                                  <div className="text-muted-foreground mb-1 font-medium">
                                    After
                                  </div>
                                  <pre className="bg-background overflow-x-auto rounded-lg border p-2">
                                    {e.after ? JSON.stringify(e.after, null, 2) : '—'}
                                  </pre>
                                </div>
                              </div>
                              <div className="text-muted-foreground mt-2 font-mono text-xs">
                                {e.targetType} {e.targetId}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
              {!query.isPending && items.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="p-0">
                    <EmptyState
                      icon={FileClock}
                      title={filtered ? 'Nothing matches those filters' : 'Nothing recorded yet'}
                      description={
                        filtered
                          ? 'Try widening the filters.'
                          : 'Changes to people, groups and spaces are recorded here.'
                      }
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
          {query.data ? `${total} ${total === 1 ? 'entry' : 'entries'}` : ' '}
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
    </>
  );
}
