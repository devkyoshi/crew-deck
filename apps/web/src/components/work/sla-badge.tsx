import { AlarmClock, CheckCircle2, Hourglass, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SlaState, WorkItem } from '@/lib/work';

type Clock = NonNullable<WorkItem['sla']>['response'];

const LOOK: Record<Exclude<SlaState, 'none'>, { text: string; icon: typeof AlarmClock; cls: string }> = {
  ok: { text: 'On track', icon: Hourglass, cls: 'text-muted-foreground' },
  due_soon: { text: 'Due soon', icon: AlarmClock, cls: 'text-amber-700 dark:text-amber-400' },
  breached: { text: 'Missed', icon: TriangleAlert, cls: 'text-red-700 dark:text-red-400' },
  met: { text: 'Met', icon: CheckCircle2, cls: 'text-emerald-700 dark:text-emerald-400' },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** One deadline: what it is, where it stands, and when it falls due. Words as well as colour. */
export function SlaChip({ label, clock }: { label: string; clock: Clock }) {
  if (clock.state === 'none' || !clock.dueAt) return null;
  const look = LOOK[clock.state];
  const Icon = look.icon;
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-xs whitespace-nowrap', look.cls)}
      title={`${label} due ${when(clock.dueAt)}`}
    >
      <Icon className="size-3.5" aria-hidden />
      <span>
        {label}: {look.text}
      </span>
    </span>
  );
}

/** The deadline that matters most right now: a missed one first, then the next due. */
export function SlaSummary({ sla }: { sla: NonNullable<WorkItem['sla']> }) {
  const order: SlaState[] = ['breached', 'due_soon', 'ok', 'met', 'none'];
  const clocks = [
    { label: 'Response', clock: sla.response },
    { label: 'Resolve', clock: sla.resolve },
  ].sort((a, b) => order.indexOf(a.clock.state) - order.indexOf(b.clock.state));
  // Once the first answer is in on time, the response clock is history: show the resolve clock instead.
  const first = clocks[0]!;
  const pick = first.clock.state === 'met' ? (clocks.find((c) => c.label === 'Resolve') ?? first) : first;
  return <SlaChip label={pick.label} clock={pick.clock} />;
}

/** Both deadlines, for the ticket's own page. */
export function SlaDetail({ sla }: { sla: NonNullable<WorkItem['sla']> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <SlaChip label="Response" clock={sla.response} />
      <SlaChip label="Resolve" clock={sla.resolve} />
    </div>
  );
}
