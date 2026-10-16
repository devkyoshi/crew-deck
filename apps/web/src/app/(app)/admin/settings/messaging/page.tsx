'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, MessageSquare, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  RETENTION_MAX_DAYS,
  RETENTION_MIN_DAYS,
  type MessagingSettingsDTO,
  type MessagingSettingsResponse,
} from '@crew-deck/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { useMe } from '@/components/shell/me-context';
import { ApiError } from '@/lib/api';
import { useBrowse } from '@/lib/messaging-api';
import {
  useExports,
  useMessagingSettings,
  useRequestExport,
  useRetentionOverrides,
  useSaveMessagingSettings,
  useSetChannelRetention,
} from '@/lib/messaging-admin-api';

const fail = (e: unknown, fallback = 'Something went wrong. Try again.') =>
  toast.error(e instanceof ApiError ? e.message : fallback);

const sizeOf = (bytes: number | null) =>
  bytes === null ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default function MessagingSettingsPage() {
  // The same rule as the server's `messaging.settings`: only the workspace owner.
  const owner = useMe().permissions.includes('messaging.settings');
  const settings = useMessagingSettings(owner);

  if (!owner) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Only the workspace owner"
        description="The owner decides how chat works here: who can create channels, how long messages are kept, and exports."
      />
    );
  }
  if (settings.isPending) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading settings">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }
  if (settings.isError) {
    return (
      <EmptyState
        icon={MessageSquare}
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
        title="Messaging"
        description="The rules for chat in this workspace, how long messages are kept, and copies of your data."
      />
      <RulesCard initial={settings.data} />
      <RetentionCard initial={settings.data} />
      <ExportCard />
    </div>
  );
}

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Type to find a public channel, then choose it. A workspace can have hundreds, so no long drop-down. */
function ChannelPicker({
  label,
  exclude,
  onPick,
  className,
}: {
  label: string;
  exclude: string[];
  onPick: (c: { id: string; name: string }) => void;
  className?: string;
}) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const found = useBrowse(q, q.length > 0);
  const hits = (found.data ?? []).filter((c) => !c.spaceId && !exclude.includes(c.id)).slice(0, 8);
  return (
    <div className={className}>
      <Label htmlFor={`pick-${label}`} className="sr-only">
        {label}
      </Label>
      <Input
        id={`pick-${label}`}
        value={text}
        placeholder={label}
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
      />
      {q && (
        <ul
          aria-label={`Channels matching ${q}`}
          className="mt-1 max-h-48 overflow-y-auto rounded-lg border p-1"
        >
          {hits.length === 0 && (
            <li className="text-muted-foreground px-2 py-1.5 text-sm">
              {found.isLoading ? 'Searching…' : 'No public channel matches'}
            </li>
          )}
          {hits.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="hover:bg-accent focus-visible:ring-ring/50 w-full rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-[3px]"
                onClick={() => {
                  onPick({ id: c.id, name: c.name ?? '' });
                  setText('');
                  setQ('');
                }}
              >
                #{c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const pick = (s: MessagingSettingsResponse): MessagingSettingsDTO => ({
  channelCreation: s.channelCreation,
  broadcastLimit: s.broadcastLimit,
  defaultChannelIds: s.defaultChannelIds,
  retentionDays: s.retentionDays,
  spaceChannels: s.spaceChannels,
  announcementDefault: s.announcementDefault,
  leaveSetsDnd: s.leaveSetsDnd,
});

function RulesCard({ initial }: { initial: MessagingSettingsResponse }) {
  const save = useSaveMessagingSettings();
  const [v, setV] = useState(pick(initial));
  const [limit, setLimit] = useState(String(initial.broadcastLimit));
  const [names, setNames] = useState(initial.defaultChannels);
  useEffect(() => {
    setV(pick(initial));
    setLimit(String(initial.broadcastLimit));
    setNames(initial.defaultChannels);
  }, [initial]);
  const limitNum = Number(limit);
  const limitOk = Number.isInteger(limitNum) && limitNum >= 0 && limitNum <= 10_000;
  const next = { ...v, broadcastLimit: limitOk ? limitNum : v.broadcastLimit };
  const dirty = JSON.stringify(next) !== JSON.stringify(pick(initial));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Channels and mentions</CardTitle>
        <CardDescription>Who can start channels, and how channels begin.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        <Row title="Who can create channels" hint="Everyone, or only workspace admins.">
          <Select
            value={v.channelCreation}
            onValueChange={(x) => setV({ ...v, channelCreation: x as 'all' | 'admins' })}
          >
            <SelectTrigger aria-label="Who can create channels" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              <SelectItem value="admins">Admins only</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row
          title="@channel and @here limit"
          hint="In channels with more people than this, only admins can use them."
        >
          <div className="space-y-1">
            <Input
              aria-label="People in a channel before @channel is limited to admins"
              inputMode="numeric"
              className="w-28"
              value={limit}
              aria-invalid={!limitOk}
              onChange={(e) => setLimit(e.target.value)}
            />
            {!limitOk && <p className="text-destructive text-xs">Enter a number up to 10000</p>}
          </div>
        </Row>
        <Row
          title="New channels are announcement-only"
          hint="Only channel owners and admins can post; everyone can still reply in threads."
        >
          <Switch
            aria-label="New channels are announcement-only"
            checked={v.announcementDefault}
            onCheckedChange={(c) => setV({ ...v, announcementDefault: c })}
          />
        </Row>
        <Row
          title="A channel for every space"
          hint="Each space gets a channel named after its key, with its people kept in step."
        >
          <Switch
            aria-label="A channel for every space"
            checked={v.spaceChannels}
            onCheckedChange={(c) => setV({ ...v, spaceChannels: c })}
          />
        </Row>
        <Row
          title="On leave pauses notifications"
          hint="People who are on leave today get no alerts or emails, like do not disturb."
        >
          <Switch
            aria-label="On leave pauses notifications"
            checked={v.leaveSetsDnd}
            onCheckedChange={(c) => setV({ ...v, leaveSetsDnd: c })}
          />
        </Row>
        <div className="space-y-2 py-3">
          <p className="text-sm font-medium">Channels new people join</p>
          <p className="text-muted-foreground text-xs">
            Besides #general and #announcements. People already here are not moved.
          </p>
          {names.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Default channels">
              {names.map((c) => (
                <li
                  key={c.id}
                  className="bg-muted flex items-center gap-1 rounded-full py-0.5 pr-1 pl-3 text-sm"
                >
                  #{c.name}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove #${c.name}`}
                    onClick={() => {
                      setV({ ...v, defaultChannelIds: v.defaultChannelIds.filter((x) => x !== c.id) });
                      setNames(names.filter((x) => x.id !== c.id));
                    }}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <ChannelPicker
            label="Find a channel to add"
            className="w-64"
            exclude={[...v.defaultChannelIds]}
            onPick={(c) => {
              setV({ ...v, defaultChannelIds: [...v.defaultChannelIds, c.id] });
              setNames([...names, c]);
            }}
          />
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button
          variant="ghost"
          disabled={!dirty}
          onClick={() => {
            setV(pick(initial));
            setLimit(String(initial.broadcastLimit));
            setNames(initial.defaultChannels);
          }}
        >
          Reset
        </Button>
        <Button
          loading={save.isPending}
          disabled={!dirty || !limitOk}
          onClick={() =>
            save.mutate(next, {
              onSuccess: () => toast.success('Messaging settings saved'),
              onError: (e) => fail(e, 'Could not save the settings'),
            })
          }
        >
          Save
        </Button>
      </CardFooter>
    </Card>
  );
}

function RetentionCard({ initial }: { initial: MessagingSettingsResponse }) {
  const save = useSaveMessagingSettings();
  const overrides = useRetentionOverrides(true);
  const setRetention = useSetChannelRetention();
  const [forever, setForever] = useState(initial.retentionDays === null);
  const [days, setDays] = useState(String(initial.retentionDays ?? 365));
  const [chan, setChan] = useState<{ id: string; name: string } | null>(null);
  const [chanDays, setChanDays] = useState('30');
  useEffect(() => {
    setForever(initial.retentionDays === null);
    setDays(String(initial.retentionDays ?? 365));
  }, [initial.retentionDays]);
  const n = Number(days);
  const daysOk = forever || (Number.isInteger(n) && n >= RETENTION_MIN_DAYS && n <= RETENTION_MAX_DAYS);
  const wanted = forever ? null : n;
  const dirty = wanted !== initial.retentionDays;
  const cn = Number(chanDays);
  const chanOk = Number.isInteger(cn) && cn >= RETENTION_MIN_DAYS && cn <= RETENTION_MAX_DAYS;
  const withOverride = new Set((overrides.data ?? []).map((o) => o.channelId));

  return (
    <Card>
      <CardHeader>
        <CardTitle>How long messages are kept</CardTitle>
        <CardDescription>
          Older messages, with their files, reactions and pins, are deleted for good. A thread is
          deleted when its last activity is older than the limit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Row title="Keep messages forever" hint="Nothing is deleted unless a channel has its own limit.">
            <Switch
              aria-label="Keep messages forever"
              checked={forever}
              onCheckedChange={setForever}
            />
          </Row>
          {!forever && (
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="ret-days">Delete messages older than</Label>
              <Input
                id="ret-days"
                inputMode="numeric"
                className="w-24"
                value={days}
                aria-invalid={!daysOk}
                onChange={(e) => setDays(e.target.value)}
              />
              <span className="text-sm">days</span>
              {!daysOk && (
                <span className="text-destructive text-xs">
                  Enter {RETENTION_MIN_DAYS} to {RETENTION_MAX_DAYS} days
                </span>
              )}
            </div>
          )}
          <div className="flex justify-end">
            <Button
              loading={save.isPending}
              disabled={!dirty || !daysOk}
              onClick={() =>
                save.mutate(
                  { ...pick(initial), retentionDays: wanted },
                  {
                    onSuccess: () => toast.success('Retention saved'),
                    onError: (e) => fail(e, 'Could not save'),
                  },
                )
              }
            >
              Save
            </Button>
          </div>
        </div>

        <div className="space-y-3 border-t pt-4">
          <div>
            <h3 className="text-sm font-semibold">Channels with their own limit</h3>
            <p className="text-muted-foreground text-xs">A channel&apos;s limit replaces the one above.</p>
          </div>
          {(overrides.data ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">No channel has its own limit.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {overrides.data!.map((o) => (
                <li key={o.channelId} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {o.type === 'public' || o.type === 'private' ? `#${o.name}` : o.name}
                  </span>
                  <span className="text-muted-foreground">{o.retentionDays} days</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={setRetention.isPending && setRetention.variables?.channelId === o.channelId}
                    onClick={() =>
                      setRetention.mutate(
                        { channelId: o.channelId, days: null },
                        { onError: (e) => fail(e) },
                      )
                    }
                  >
                    Use the default
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              {chan ? (
                <p className="flex h-9 items-center gap-1 text-sm">
                  #{chan.name}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Choose a different channel"
                    onClick={() => setChan(null)}
                  >
                    <X />
                  </Button>
                </p>
              ) : (
                <ChannelPicker
                  label="Find a channel"
                  className="w-56"
                  exclude={[...withOverride]}
                  onPick={setChan}
                />
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="ret-chan-days">Days</Label>
              <Input
                id="ret-chan-days"
                inputMode="numeric"
                className="w-24"
                value={chanDays}
                aria-invalid={!chanOk}
                onChange={(e) => setChanDays(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              disabled={!chan || !chanOk}
              loading={setRetention.isPending && setRetention.variables?.channelId === chan?.id}
              onClick={() =>
                setRetention.mutate(
                  { channelId: chan!.id, days: cn },
                  {
                    onSuccess: () => {
                      setChan(null);
                      toast.success('Channel limit saved');
                    },
                    onError: (e) => fail(e),
                  },
                )
              }
            >
              Set limit
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ExportCard() {
  const exports = useExports(true);
  const request = useRequestExport();
  const busy = (exports.data ?? []).some((e) => e.status === 'queued' || e.status === 'running');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Export your chat</CardTitle>
        <CardDescription>
          A file with the public channels, their messages, reactions and file names, and the people who
          wrote them. Private channels and direct messages are not included. Files are kept for 7 days.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          loading={request.isPending || busy}
          onClick={() =>
            request.mutate(undefined, {
              onSuccess: () => toast.success('Preparing your export'),
              onError: (e) => fail(e, 'Could not start the export'),
            })
          }
        >
          {busy ? 'Preparing…' : 'Create an export'}
        </Button>
        {(exports.data ?? []).length > 0 && (
          <ul className="divide-y rounded-lg border" aria-label="Exports">
            {exports.data!.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  {new Date(e.createdAt).toLocaleString([], {
                    day: 'numeric',
                    month: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                  {e.counts && (
                    <span className="text-muted-foreground">
                      {' '}
                      · {e.counts.channels} channels, {e.counts.messages} messages · {sizeOf(e.sizeBytes)}
                    </span>
                  )}
                </span>
                {e.status === 'done' ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={`/api/v1/admin/export/${e.id}/file`} download>
                      <Download /> Download
                    </a>
                  </Button>
                ) : e.status === 'failed' ? (
                  <span className="text-destructive">Failed{e.error ? `: ${e.error}` : ''}</span>
                ) : (
                  <span className="text-muted-foreground" role="status">
                    Preparing…
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
