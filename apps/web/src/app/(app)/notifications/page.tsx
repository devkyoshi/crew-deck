'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CheckCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { LoadError } from '@/components/shared/load-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NotificationRow } from '@/components/notifications/notification-row';
import { useHydrated } from '@/components/checkin/use-hydrated';
import {
  TYPE_LABELS,
  useMarkRead,
  useNotifications,
  usePreferences,
  useSavePreferences,
  type NotificationType,
} from '@/lib/notifications-api';

export default function NotificationsPage() {
  const [tab, setTab] = useState('all');
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Notifications" description="What happened on work you are part of." />
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList aria-label="Notifications">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">Unread</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="all">
          <Inbox unreadOnly={false} />
        </TabsContent>
        <TabsContent value="unread">
          <Inbox unreadOnly />
        </TabsContent>
        <TabsContent value="settings">
          <Settings />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Inbox({ unreadOnly }: { unreadOnly: boolean }) {
  const router = useRouter();
  const list = useNotifications(unreadOnly);
  const markRead = useMarkRead();
  // The bell may already hold this list; wait for hydration so the first render matches the server.
  const hydrated = useHydrated();
  if (list.isError) return <LoadError what="your notifications" onRetry={() => list.refetch()} />;
  if (!list.data || !hydrated) return <p className="text-muted-foreground text-sm">Loading…</p>;
  const items = list.data.pages.flatMap((p) => p.items);
  const unread = list.data.pages[0]?.unreadCount ?? 0;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {unread ? `${unread} unread` : 'Nothing unread'}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={!unread || markRead.isPending}
          onClick={() => markRead.mutate({ all: true })}
        >
          <CheckCheck /> Mark all read
        </Button>
      </div>
      {items.length === 0 ? (
        <EmptyState
          title="You are all caught up"
          description="New assignments, mentions and comments show up here."
        />
      ) : (
        <ul className="bg-card divide-y overflow-hidden rounded-xl border">
          {items.map((n) => (
            <NotificationRow
              key={n.id}
              n={n}
              onOpen={(href) => {
                if (!n.readAt) markRead.mutate({ ids: [n.id] });
                router.push(href);
              }}
            />
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          disabled={list.isFetchingNextPage}
          onClick={() => list.fetchNextPage()}
        >
          {list.isFetchingNextPage && <Loader2 className="animate-spin" />} Show older
        </Button>
      )}
    </div>
  );
}

function Settings() {
  const prefs = usePreferences();
  const save = useSavePreferences();
  if (prefs.isError) return <LoadError what="your settings" onRetry={() => prefs.refetch()} />;
  if (!prefs.data) return <p className="text-muted-foreground text-sm">Loading…</p>;
  const p = prefs.data.preferences;
  const set = (type: NotificationType, channel: 'inApp' | 'email', on: boolean) =>
    save.mutate(
      { preferences: { [type]: { ...p[type], [channel]: on } } },
      { onError: () => toast.error('Could not save that') },
    );
  return (
    <div className="space-y-3">
      <div className="bg-card flex items-center justify-between gap-4 rounded-xl border p-3 text-sm">
        <div>
          <p className="font-medium">Daily summary</p>
          <p className="text-muted-foreground text-xs">
            Get one email each morning (8:00 in your timezone) instead of emails a few minutes after
            each update.
          </p>
        </div>
        <Switch
          aria-label="Send one daily summary email"
          checked={prefs.data.digest}
          onCheckedChange={(v) =>
            save.mutate({ digest: v }, { onError: () => toast.error('Could not save that') })
          }
        />
      </div>
      <MessagingSettings
        quiet={prefs.data.quiet}
        emailDelayMinutes={prefs.data.emailDelayMinutes}
        desktop={prefs.data.desktop}
        save={(body) => save.mutate(body, { onError: () => toast.error('Could not save that') })}
      />
      <div className="bg-card overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <caption className="text-muted-foreground p-3 text-left text-xs">
            {prefs.data.digest
              ? 'Emails are collected into the daily summary.'
              : 'Emails are collected and sent together a few minutes after the first one, so a busy morning is one email.'}
          </caption>
          <thead className="text-muted-foreground border-y text-xs">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Tell me when
              </th>
              <th scope="col" className="w-24 px-3 py-2 font-medium">
                In the app
              </th>
              <th scope="col" className="w-24 px-3 py-2 font-medium">
                By email
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(Object.keys(TYPE_LABELS) as NotificationType[]).map((type) => (
              <tr key={type}>
                <th scope="row" className="px-3 py-2.5 text-left font-normal">
                  {TYPE_LABELS[type]}
                </th>
                <td className="px-3 py-2.5 text-center">
                  <Switch
                    aria-label={`${TYPE_LABELS[type]}: in the app`}
                    checked={p[type].inApp}
                    onCheckedChange={(v) => set(type, 'inApp', v)}
                  />
                </td>
                <td className="px-3 py-2.5 text-center">
                  <Switch
                    aria-label={`${TYPE_LABELS[type]}: by email`}
                    checked={p[type].email}
                    onCheckedChange={(v) => set(type, 'email', v)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const DELAYS = [5, 15, 30, 60, 120];

/** Messages: desktop alerts, quiet hours and how long an unseen message waits before it is emailed. */
function MessagingSettings({
  quiet,
  emailDelayMinutes,
  desktop,
  save,
}: {
  quiet: { enabled: boolean; start: string; end: string };
  emailDelayMinutes: number;
  desktop: boolean;
  save: (body: { quiet?: typeof quiet; emailDelayMinutes?: number; desktop?: boolean }) => void;
}) {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  useEffect(() => {
    setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  }, []);
  const turnOnDesktop = async (on: boolean) => {
    if (!on) return save({ desktop: false });
    if (typeof Notification === 'undefined')
      return toast.error('This browser cannot show desktop notifications');
    // Asked now, because the person just chose to turn it on (never on first load).
    const result =
      Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission;
    setPermission(result);
    if (result !== 'granted')
      return toast.error(
        'Desktop notifications are blocked. Allow them in your browser’s site settings.',
      );
    save({ desktop: true });
  };
  return (
    <div className="bg-card divide-y rounded-xl border text-sm">
      <div className="flex items-center justify-between gap-4 p-3">
        <div>
          <p className="font-medium">Desktop notifications</p>
          <p className="text-muted-foreground text-xs">
            {permission === 'denied'
              ? 'Blocked in this browser. Allow notifications for this site to use them.'
              : permission === 'unsupported'
                ? 'This browser cannot show them.'
                : 'A pop-up for new messages and mentions while this tab is in the background.'}
          </p>
        </div>
        <Switch
          aria-label="Desktop notifications"
          checked={desktop && permission === 'granted'}
          disabled={permission === 'denied' || permission === 'unsupported'}
          onCheckedChange={(v) => void turnOnDesktop(v)}
        />
      </div>
      <div className="space-y-3 p-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">Quiet hours</p>
            <p className="text-muted-foreground text-xs">
              No desktop alerts or emails in this window (your timezone). Badges and the inbox still
              update.
            </p>
          </div>
          <Switch
            aria-label="Quiet hours"
            checked={quiet.enabled}
            onCheckedChange={(v) => save({ quiet: { ...quiet, enabled: v } })}
          />
        </div>
        {quiet.enabled && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              From
              <Input
                type="time"
                value={quiet.start}
                onChange={(e) =>
                  e.target.value && save({ quiet: { ...quiet, start: e.target.value } })
                }
                className="h-8 w-28"
              />
            </label>
            <label className="flex items-center gap-2">
              Until
              <Input
                type="time"
                value={quiet.end}
                onChange={(e) =>
                  e.target.value && save({ quiet: { ...quiet, end: e.target.value } })
                }
                className="h-8 w-28"
              />
            </label>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-4 p-3">
        <div>
          <p className="font-medium">Email delay</p>
          <p className="text-muted-foreground text-xs">
            A direct message or mention is emailed only if you have not seen it after this long.
          </p>
        </div>
        <Select
          value={String(emailDelayMinutes)}
          onValueChange={(v) => save({ emailDelayMinutes: Number(v) })}
        >
          <SelectTrigger aria-label="Email delay" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DELAYS.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {m >= 60 ? `${m / 60} hour${m > 60 ? 's' : ''}` : `${m} minutes`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
