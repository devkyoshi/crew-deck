'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, Search, SearchX } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
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
import { Notice } from '@/components/shared/notice';
import { PageHeader } from '@/components/shared/page-header';
import { api, ApiError, qs } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  domain: string;
  status: 'active' | 'suspended';
  suspendedReason: string | null;
  planKey: string | null;
  onTrial: boolean;
  trialEndsAt: string | null;
  createdAt: string;
  createdVia: string;
  memberCount: number;
  lastLoginAt: string | null;
}

export const planLabel = (t: { planKey: string | null; onTrial: boolean }) =>
  t.planKey === null
    ? 'Internal'
    : `${t.planKey[0]!.toUpperCase()}${t.planKey.slice(1)}${t.onTrial ? ' (trial)' : ''}`;

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function CreateTenant() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [plan, setPlan] = useState('team');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const plans = useQuery({
    queryKey: ['platform-plans'],
    queryFn: () => api<{ items: { key: string; name: string }[] }>('/platform/plans'),
    enabled: open,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const res = await api<{ inviteLink?: string }>('/platform/tenants', {
        body: {
          name: name.trim(),
          slug: slug.trim().toLowerCase(),
          ownerEmail: ownerEmail.trim().toLowerCase(),
          plan,
        },
      });
      toast.success('Workspace created. The owner has been emailed an invitation.');
      await qc.invalidateQueries({ queryKey: ['platform-tenants'] });
      if (res.inviteLink) setLink(res.inviteLink);
      else setOpen(false);
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length)
        setErrors(err.fields);
      else toast.error(err instanceof ApiError ? err.message : 'Could not create the workspace');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setLink(null);
          setName('');
          setSlug('');
          setOwnerEmail('');
          setErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden /> New workspace
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>
            The owner gets an email invitation and sets their own password.
          </DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="space-y-3">
            <Notice variant="info">
              Email is not set up on this server. Give the owner this link:{' '}
              <a className="font-medium break-all underline" href={link}>
                {link}
              </a>
            </Notice>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Company name" htmlFor="t-name" error={errors.name}>
              <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field
              label="Workspace address"
              htmlFor="t-slug"
              error={errors.slug}
              hint="Lowercase letters, numbers and hyphens"
            >
              <Input value={slug} maxLength={30} onChange={(e) => setSlug(e.target.value)} />
            </Field>
            <Field label="Owner email" htmlFor="t-owner" error={errors.ownerEmail}>
              <Input
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
              />
            </Field>
            <div className="space-y-1.5">
              <label htmlFor="t-plan" className="text-sm font-medium">
                Plan
              </label>
              <Select value={plan} onValueChange={setPlan}>
                <SelectTrigger id="t-plan" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(plans.data?.items ?? [{ key: 'team', name: 'Team' }]).map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create workspace'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function PlatformTenantsPage() {
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [q, status]);
  const params = { q, status: status === 'all' ? undefined : status, page, pageSize: 20 };
  const query = useQuery({
    queryKey: ['platform-tenants', params],
    queryFn: () => api<{ items: TenantRow[]; total: number }>(`/platform/tenants${qs(params)}`),
    placeholderData: keepPreviousData,
  });
  const pages = Math.max(1, Math.ceil((query.data?.total ?? 0) / 20));

  return (
    <div>
      <PageHeader
        title="Workspaces"
        description={`${query.data?.total ?? '…'} workspaces on the platform`}
        action={<CreateTenant />}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative w-full max-w-xs">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-2.5 left-3 size-4"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, address or domain"
            aria-label="Search workspaces"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {query.isError ? (
        <ErrorView error={query.error} reset={() => query.refetch()} />
      ) : query.isPending ? (
        <Skeleton role="status" aria-label="Loading" className="h-64 w-full rounded-2xl" />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No workspaces match"
          description="Try a different search or filter."
        />
      ) : (
        <>
          <div className="bg-card rounded-2xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>People</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last sign-in</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link
                        href={`/platform/tenants/${t.id}`}
                        className="font-medium hover:underline"
                      >
                        {t.name}
                      </Link>
                      <div className="text-muted-foreground text-xs">
                        {t.slug} · {t.domain}
                      </div>
                    </TableCell>
                    <TableCell>{planLabel(t)}</TableCell>
                    <TableCell className="tabular-nums">{t.memberCount}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          'rounded-full border-transparent font-normal',
                          t.status === 'suspended'
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
                        )}
                      >
                        {t.status === 'suspended' ? 'Suspended' : 'Active'}
                      </Badge>
                    </TableCell>
                    <TableCell>{t.lastLoginAt ? timeAgo(t.lastLoginAt) : 'Never'}</TableCell>
                    <TableCell>{formatDate(t.createdAt)}</TableCell>
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
