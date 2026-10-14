'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, LayoutGrid, Users, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/empty-state';
import { IconTile, type Tone } from '@/components/shared/pastel';
import { TeamWidget } from '@/components/checkin/team-board';
import { useToday } from '@/components/checkin/use-today';
import { useMe } from '@/components/shell/me-context';

const SHORTCUTS: { title: string; sub: string; href: string; icon: typeof Users; tone: Tone }[] = [
  { title: 'People', sub: 'Your teammates', href: '/people', icon: Users, tone: 'blue' },
  {
    title: 'Groups',
    sub: 'Teams and departments',
    href: '/groups',
    icon: UsersRound,
    tone: 'violet',
  },
  {
    title: 'Spaces',
    sub: 'Projects and workspaces',
    href: '/spaces',
    icon: LayoutGrid,
    tone: 'green',
  },
];

export default function HomePage() {
  const { user, org } = useMe();
  const first = user.name?.split(' ')[0] ?? 'there';
  const checkinOn = useToday().data?.enabled === true;
  // The date depends on the viewer's timezone, which the server does not know. Rendering it on the
  // server would disagree with the browser near midnight (a hydration error), so it appears after mount.
  const [today, setToday] = useState(' ');
  useEffect(() => {
    setToday(
      new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long' }).format(
        new Date(),
      ),
    );
  }, []);

  return (
    <div className="space-y-6">
      <header className="space-y-0.5">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{today}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{`Hello, ${first}`}</h1>
        <p className="text-muted-foreground text-sm">Here is what is happening in {org.name}.</p>
      </header>

      {checkinOn && <TeamWidget />}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Jump in</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SHORTCUTS.map((s, i) => (
            <Link
              key={s.href}
              href={s.href}
              className="group animate-fade-up focus-visible:outline-none"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <Card className="hover:border-primary/40 group-focus-visible:ring-ring/50 flex-row items-center gap-3 px-4 py-3.5 shadow-none transition-colors group-focus-visible:ring-[3px]">
                <IconTile tone={s.tone} icon={s.icon} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{s.title}</div>
                  <div className="text-muted-foreground truncate text-xs">{s.sub}</div>
                </div>
                <ArrowRight
                  className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Your work</h2>
        <EmptyState
          illustration="empty"
          title="Nothing here yet"
          description="Spaces, tasks and updates will show up here as your team starts using the workspace."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href="/spaces">Browse spaces</Link>
            </Button>
          }
        />
      </section>
    </div>
  );
}
