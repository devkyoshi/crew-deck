'use client';

import Link from 'next/link';
import { ArrowRight, LayoutGrid, Sparkles, Users, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/empty-state';
import { HeroBanner } from '@/components/shared/hero-banner';
import { IconTile, type Tone } from '@/components/shared/pastel';
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
  const today = new Intl.DateTimeFormat('en', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  return (
    <div className="space-y-8">
      <HeroBanner
        eyebrow={today}
        title={`Hello, ${first}`}
        badge={
          <span className="bg-card/90 inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm shadow-soft">
            <Sparkles className="text-primary size-4" aria-hidden />
            Welcome to {org.name}
          </span>
        }
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Jump in</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SHORTCUTS.map((s) => (
            <Link key={s.href} href={s.href} className="group focus-visible:outline-none">
              <Card className="hover:border-primary/40 group-focus-visible:ring-ring/50 flex-row items-center gap-3 p-4 shadow-none transition-colors group-focus-visible:ring-[3px]">
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
          icon={Sparkles}
          title="Nothing here yet"
          description="Spaces, tasks and updates will show up here as your team starts using the workspace."
          action={
            <Button variant="outline" asChild>
              <Link href="/spaces">Browse spaces</Link>
            </Button>
          }
        />
      </section>
    </div>
  );
}
