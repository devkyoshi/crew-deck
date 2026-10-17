'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, MapPin, Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react';
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
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { useIsAdmin } from '@/components/shell/me-context';
import { api, ApiError, qs, type Holiday, type Site, type WorkSettingsView } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { WEEKDAYS } from '@/lib/locations';
import { cn } from '@/lib/utils';

const fail = (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

export default function WorkSettingsPage() {
  const isAdmin = useIsAdmin();
  const settings = useQuery({
    queryKey: ['work-settings'],
    queryFn: () => api<{ settings: WorkSettingsView; sites: Site[] }>('/settings/work'),
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Admins only"
        description="You need to be a workspace admin to change these settings."
      />
    );
  }
  if (settings.isPending) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading settings">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }
  if (settings.isError) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Could not load settings"
        description="Something went wrong."
        action={
          <Button variant="outline" onClick={() => settings.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/admin/settings">
          <ArrowLeft /> Settings
        </Link>
      </Button>
      <PageHeader
        title="Work and check-in"
        description="When people work, where they can check in from, and what counts as a holiday."
      />
      <HoursCard initial={settings.data.settings} />
      <SitesCard />
      <HolidaysCard />
    </div>
  );
}

function HoursCard({ initial }: { initial: WorkSettingsView }) {
  const qc = useQueryClient();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => setV(initial), [initial]);
  const zones =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

  const save = useMutation({
    mutationFn: () => api('/settings/work', { method: 'PUT', body: v }),
    onSuccess: () => {
      toast.success('Settings saved');
      setErrors({});
      for (const k of ['work-settings', 'me-today', 'me-week', 'team'])
        qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      else fail(e);
    },
  });

  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const toggleDay = (d: number) =>
    setV((s) => ({
      ...s,
      workDays: s.workDays.includes(d)
        ? s.workDays.filter((x) => x !== d)
        : [...s.workDays, d].sort(),
    }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hours and rules</CardTitle>
        <CardDescription>These apply to everyone. Times are 24-hour.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div>
            <Label htmlFor="w-enabled">Check-in is on</Label>
            <p className="text-muted-foreground text-xs">
              Turn it off to hide check-in, the team board and attendance for everyone.
            </p>
          </div>
          <Switch
            id="w-enabled"
            checked={v.checkinEnabled}
            onCheckedChange={(c) => setV({ ...v, checkinEnabled: c })}
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Working days</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((name, i) => {
              const day = i + 1;
              const on = v.workDays.includes(day);
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(day)}
                  className={cn(
                    'hover:bg-accent h-9 w-14 rounded-lg border text-sm transition-colors',
                    on && 'border-primary bg-accent text-accent-foreground ring-primary/30 ring-2',
                  )}
                >
                  {name}
                </button>
              );
            })}
          </div>
          {errors.workDays && <p className="text-destructive text-xs">{errors.workDays}</p>}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="w-start">Day starts</Label>
            <Input
              id="w-start"
              type="time"
              value={v.workStart}
              onChange={(e) => setV({ ...v, workStart: e.target.value })}
              aria-invalid={!!errors.workStart}
            />
            {errors.workStart && <p className="text-destructive text-xs">{errors.workStart}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="w-end">Day ends</Label>
            <Input
              id="w-end"
              type="time"
              value={v.workEnd}
              onChange={(e) => setV({ ...v, workEnd: e.target.value })}
              aria-invalid={!!errors.workEnd}
            />
            {errors.workEnd && <p className="text-destructive text-xs">{errors.workEnd}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="w-auto">Close open check-ins at</Label>
            <Input
              id="w-auto"
              type="time"
              value={v.autoCloseTime}
              onChange={(e) => setV({ ...v, autoCloseTime: e.target.value })}
              aria-invalid={!!errors.autoCloseTime}
            />
            <p className="text-muted-foreground text-xs">In each person&apos;s own timezone.</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="w-tz">Default timezone</Label>
          <Input
            id="w-tz"
            list="tz-list"
            className="max-w-sm"
            value={v.timezone}
            onChange={(e) => setV({ ...v, timezone: e.target.value })}
            aria-invalid={!!errors.timezone}
          />
          <datalist id="tz-list">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <p className="text-muted-foreground text-xs">
            Used for people who have not set their own.
          </p>
          {errors.timezone && <p className="text-destructive text-xs">{errors.timezone}</p>}
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div>
            <Label htmlFor="w-note">Require a note at check-out</Label>
            <p className="text-muted-foreground text-xs">
              People must say what they worked on before they can check out.
            </p>
          </div>
          <Switch
            id="w-note"
            checked={v.requireNote}
            onCheckedChange={(c) => setV({ ...v, requireNote: c })}
          />
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </CardFooter>
    </Card>
  );
}

function SitesCard() {
  const qc = useQueryClient();
  const sites = useQuery({ queryKey: ['sites'], queryFn: () => api<{ items: Site[] }>('/sites') });
  const [editing, setEditing] = useState<Site | 'new' | null>(null);
  const [removing, setRemoving] = useState<Site | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sites'] });
    qc.invalidateQueries({ queryKey: ['work-settings'] });
    qc.invalidateQueries({ queryKey: ['me-today'] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => api(`/sites/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Site deleted');
      setRemoving(null);
      refresh();
    },
    onError: (e) => {
      setRemoving(null);
      fail(e);
    },
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Sites</CardTitle>
          <CardDescription>
            Offices people can check in at. Once a site exists, onsite check-ins must choose one.
          </CardDescription>
        </div>
        <Button variant="outline" onClick={() => setEditing('new')}>
          <Plus /> Add site
        </Button>
      </CardHeader>
      <CardContent>
        {sites.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : sites.isError ? (
          <EmptyState
            icon={MapPin}
            title="Could not load sites"
            description="Something went wrong."
            action={
              <Button variant="outline" onClick={() => sites.refetch()}>
                Try again
              </Button>
            }
          />
        ) : sites.data.items.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title="No sites yet"
            description="Add your offices so people can say where they are working."
          />
        ) : (
          <ul className="divide-y rounded-lg border">
            {sites.data.items.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="font-medium">{s.name}</div>
                  {s.address && (
                    <div className="text-muted-foreground truncate text-xs">{s.address}</div>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${s.name}`}
                    onClick={() => setEditing(s)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${s.name}`}
                    onClick={() => setRemoving(s)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {editing && (
        <SiteDialog
          site={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}

      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Sites people have already checked in at cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() => removing && remove.mutate(removing.id)}
            >
              Delete site
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function SiteDialog({
  site,
  onClose,
  onSaved,
}: {
  site: Site | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(site?.name ?? '');
  const [address, setAddress] = useState(site?.address ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return setErrors({ name: 'Enter a name' });
    setSaving(true);
    try {
      await api(site ? `/sites/${site.id}` : '/sites', {
        method: site ? 'PATCH' : 'POST',
        body: { name, address },
      });
      toast.success(site ? 'Site updated' : 'Site added');
      onSaved();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      else fail(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{site ? 'Edit site' : 'Add a site'}</DialogTitle>
          <DialogDescription>People choose a site when they check in as onsite.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="site-name">Name</Label>
            <Input
              id="site-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!errors.name}
            />
            {errors.name && <p className="text-destructive text-xs">{errors.name}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="site-address">Address (optional)</Label>
            <Input id="site-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HolidaysCard() {
  const qc = useQueryClient();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const holidays = useQuery({
    queryKey: ['holidays', year],
    queryFn: () => api<{ items: Holiday[] }>(`/holidays${qs({ year })}`),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['holidays'] });
    qc.invalidateQueries({ queryKey: ['me-today'] });
    qc.invalidateQueries({ queryKey: ['me-week'] });
    qc.invalidateQueries({ queryKey: ['team'] });
  };
  const add = useMutation({
    mutationFn: () => api('/holidays', { body: { date, name } }),
    onSuccess: () => {
      toast.success('Holiday added');
      setDate('');
      setName('');
      setErrors({});
      refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      else fail(e);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/holidays/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Holiday removed');
      refresh();
    },
    onError: fail,
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Holidays</CardTitle>
          <CardDescription>
            Days the whole workspace is off. People can still check in if they work.
          </CardDescription>
        </div>
        <Select value={String(year)} onValueChange={(y) => setYear(Number(y))}>
          <SelectTrigger className="w-28" aria-label="Year">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!date || !name.trim())
              return setErrors({
                ...(date ? {} : { date: 'Choose a date' }),
                ...(name.trim() ? {} : { name: 'Enter a name' }),
              });
            add.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="h-date">Date</Label>
            <Input
              id="h-date"
              type="date"
              className="w-44"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-invalid={!!errors.date}
            />
            {errors.date && <p className="text-destructive text-xs">{errors.date}</p>}
          </div>
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label htmlFor="h-name">Name</Label>
            <Input
              id="h-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!errors.name}
            />
            {errors.name && <p className="text-destructive text-xs">{errors.name}</p>}
          </div>
          <Button type="submit" disabled={add.isPending}>
            <Plus /> Add holiday
          </Button>
        </form>

        {holidays.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : holidays.isError ? (
          <EmptyState
            icon={CalendarDays}
            title="Could not load holidays"
            description="Something went wrong."
            action={
              <Button variant="outline" onClick={() => holidays.refetch()}>
                Try again
              </Button>
            }
          />
        ) : holidays.data.items.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={`No holidays in ${year}`}
            description="Add the days your workspace is closed."
          />
        ) : (
          <ul className="divide-y rounded-lg border">
            {holidays.data.items.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 p-3">
                <div>
                  <span className="font-medium">{h.name}</span>
                  <span className="text-muted-foreground ml-3 text-sm">{shortDate(h.date)}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${h.name}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(h.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
