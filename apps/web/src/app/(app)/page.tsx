'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ListTodo,
  MessagesSquare,
  Users,
  UsersRound,
} from 'lucide-react';
import { Illustration } from '@/components/illustrations';
import { WorkspaceScene } from '@/components/illustrations/workspace-scene';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/shared/stat-card';
import { CountUp, FadeIn, Stagger, StaggerItem } from '@/components/shared/motion';
import { LoadError } from '@/components/shared/load-error';
import { ListSkeleton } from '@/components/shared/skeletons';
import { TeamWidget } from '@/components/checkin/team-board';
import { useToday } from '@/components/checkin/use-today';
import { InviteDialog } from '@/components/members/invite-dialog';
import { useIsAdmin, useMe } from '@/components/shell/me-context';
import { SpaceIcon } from '@/components/spaces/space-bits';
import { DueDate, StatusChip, TypeIcon } from '@/components/work/work-bits';
import { useUnreadSummary } from '@/lib/messaging-api';
import { useRecentSpaces } from '@/lib/recent-spaces';
import { useMyItems } from '@/lib/work-find-api';

const ymd = (d: Date) => d.toLocaleDateString('en-CA');

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card rounded-xl border">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <h2 className="text-heading">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function HomePage() {
  const { user, org } = useMe();
  const isAdmin = useIsAdmin();
  const first = user.name?.split(' ')[0] ?? 'there';
  const checkinOn = useToday().data?.enabled === true;
  const mine = useMyItems('assigned', 'open');
  const unread = useUnreadSummary();
  const recent = useRecentSpaces();
  // The date depends on the viewer's timezone, which the server does not know. Rendering it on the
  // server would disagree with the browser near midnight (a hydration error), so it appears after mount.
  const [today, setToday] = useState(' ');
  const [todayKey, setTodayKey] = useState('');
  useEffect(() => {
    const now = new Date();
    setToday(
      new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long' }).format(now),
    );
    setTodayKey(ymd(now));
  }, []);

  const items = useMemo(
    () =>
      [...(mine.data?.items ?? [])].sort((a, b) =>
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'),
      ),
    [mine.data],
  );
  const weekEnd = todayKey
    ? ymd(new Date(new Date(`${todayKey}T00:00:00`).getTime() + 7 * 86_400_000))
    : '';
  const overdue = todayKey ? items.filter((i) => i.dueDate && i.dueDate < todayKey).length : 0;
  const dueSoon = todayKey
    ? items.filter((i) => i.dueDate && i.dueDate >= todayKey && i.dueDate <= weekEnd).length
    : 0;
  const messages = unread.dms + unread.channels;

  const summary = !mine.data
    ? `Here is what is happening in ${org.name}.`
    : items.length === 0
      ? `You are all caught up in ${org.name}.`
      : `You have ${items.length} open ${items.length === 1 ? 'item' : 'items'}${dueSoon ? `, ${dueSoon} due this week` : ''}${overdue ? ` and ${overdue} overdue` : ''}.`;

  return (
    <div className="space-y-6">
      <FadeIn>
        <section className="bg-card overflow-hidden rounded-xl border">
          <div className="grid items-center gap-4 p-6 sm:p-8 md:grid-cols-[1fr_minmax(0,340px)]">
            <div className="space-y-5">
              <div className="space-y-1.5">
                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {today}
                </p>
                <h1 className="text-display">{`Hello, ${first}`}</h1>
                <p className="text-muted-foreground max-w-md text-sm">{summary}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" asChild>
                  <Link href="/my-work">
                    <ListTodo /> My work
                  </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/people">
                    <Users /> People
                  </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/groups">
                    <UsersRound /> Groups
                  </Link>
                </Button>
                {isAdmin && <InviteDialog variant="soft" size="sm" />}
              </div>
            </div>
            <WorkspaceScene className="hidden md:block" />
          </div>
        </section>
      </FadeIn>

      <Stagger className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StaggerItem>
          <StatCard
            icon={ListTodo}
            tone="blue"
            label="Open items"
            value={mine.data ? <CountUp value={items.length} /> : '–'}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            icon={CalendarClock}
            tone="amber"
            label="Due this week"
            value={mine.data ? <CountUp value={dueSoon} /> : '–'}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            icon={AlertTriangle}
            tone="pink"
            label="Overdue"
            value={mine.data ? <CountUp value={overdue} /> : '–'}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard icon={MessagesSquare} tone="violet" label="Unread chats" value={<CountUp value={messages} />} />
        </StaggerItem>
      </Stagger>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel
          title="My work"
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/my-work">
                View all <ArrowRight />
              </Link>
            </Button>
          }
        >
          {mine.isError ? (
            <LoadError what="your work" onRetry={() => mine.refetch()} />
          ) : !mine.data ? (
            <ListSkeleton rows={4} className="rounded-none border-0 border-t" />
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-6 pt-2 pb-8 text-center">
              <Illustration name="empty" />
              <p className="text-sm font-medium">Nothing here yet</p>
              <p className="text-muted-foreground max-w-xs text-sm">
                Work assigned to you will show up here as your team starts using the workspace.
              </p>
              <Button variant="outline" size="sm" className="mt-3" asChild>
                <Link href="/spaces">Browse spaces</Link>
              </Button>
            </div>
          ) : (
            <ul className="divide-y border-t">
              {items.slice(0, 6).map((i) => (
                <li key={i.id}>
                  <Link
                    href={`/spaces/${i.spaceKey}/board?item=${i.key}`}
                    className="hover:bg-accent/60 flex items-center gap-3 px-5 py-2.5 transition-colors"
                  >
                    <TypeIcon type={i.type} />
                    <span className="text-muted-foreground w-16 shrink-0 font-mono text-xs">
                      {i.key}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{i.title}</span>
                    <StatusChip
                      name={i.status.name}
                      category={i.status.category}
                      className="hidden sm:inline-flex"
                    />
                    {i.dueDate && <DueDate date={i.dueDate} done={i.status.category === 'done'} />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Recent spaces"
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/spaces">
                All <ArrowRight />
              </Link>
            </Button>
          }
        >
          {recent.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-6 pt-2 pb-8 text-center">
              <Illustration name="spaces" />
              <p className="text-muted-foreground max-w-[14rem] text-sm">
                Open a space and it will be here the next time.
              </p>
            </div>
          ) : (
            <ul className="space-y-0.5 border-t p-2">
              {recent.slice(0, 5).map((s) => (
                <li key={s.key}>
                  <Link
                    href={`/spaces/${s.key}/board`}
                    className="hover:bg-accent/60 flex items-center gap-3 rounded-lg px-3 py-2 transition-colors"
                  >
                    <SpaceIcon icon={s.icon} spaceKey={s.key} className="size-8 rounded-lg" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
                    <span className="text-muted-foreground font-mono text-xs">{s.key}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {checkinOn && <TeamWidget />}
    </div>
  );
}
