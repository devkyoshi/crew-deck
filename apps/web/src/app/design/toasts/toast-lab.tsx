'use client';

import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  CircleCheck,
  Info,
  Loader2,
  OctagonX,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { ThemeToggle } from '@/components/theme-toggle';
import { DropToast } from '@/components/shared/drop-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Kind = 'success' | 'error' | 'warning' | 'info' | 'loading';

const TONE: Record<Kind, { color: string; icon: LucideIcon; label: string }> = {
  success: { color: 'var(--success)', icon: CircleCheck, label: 'Success' },
  error: { color: 'var(--destructive)', icon: OctagonX, label: 'Error' },
  warning: { color: 'var(--warning)', icon: TriangleAlert, label: 'Warning' },
  info: { color: 'var(--info)', icon: Info, label: 'Info' },
  loading: { color: 'var(--muted-foreground)', icon: Loader2, label: 'Loading' },
};

interface Props {
  kind: Kind;
  title: string;
  description: string;
  duration: number;
  id: string | number;
}

const mix = (tone: string, pct: number, base = 'transparent') =>
  `color-mix(in oklch, ${tone} ${pct}%, ${base})`;

function KindIcon({ kind, className }: { kind: Kind; className?: string }) {
  const Icon = TONE[kind].icon;
  return <Icon className={cn(kind === 'loading' && 'animate-spin', className)} aria-hidden />;
}

/* 1. ISLAND: a dark pill that starts as a dot and stretches open, like a phone's dynamic island. */
function Island({ kind, title, description }: Props) {
  const { color } = TONE[kind];
  return (
    <motion.div
      initial={{ width: 44, height: 44, opacity: 0, y: -24 }}
      animate={{ width: 340, height: description ? 72 : 52, opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 360, damping: 24 }}
      style={{ maxWidth: '92vw', background: 'var(--foreground)', color: 'var(--background)' }}
      className="flex items-center gap-3 overflow-hidden rounded-[26px] px-2.5 shadow-pop"
    >
      <motion.span
        initial={{ scale: 0, rotate: -120 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ delay: 0.18, type: 'spring', stiffness: 520, damping: 16 }}
        className="grid size-8 shrink-0 place-items-center rounded-full"
        style={{ background: color, color: '#fff' }}
      >
        <KindIcon kind={kind} className="size-4" />
      </motion.span>
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.24, duration: 0.25 }}
        className="min-w-0"
      >
        <p className="truncate text-sm font-medium">{title}</p>
        {description && <p className="truncate text-xs opacity-70">{description}</p>}
      </motion.div>
    </motion.div>
  );
}

/* 2. DROP: the one the app uses (components/shared/drop-toast.tsx). */
function Drop({ kind, title, description }: Props) {
  return <DropToast kind={kind} title={title} description={description || undefined} />;
}

/* 3. GLASS: a soft tinted card with a glow and a countdown ring around the icon. */
function Glass({ kind, title, description, duration }: Props) {
  const { color } = TONE[kind];
  return (
    <motion.div
      initial={{ y: -48, opacity: 0, scale: 0.92 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      className="relative flex w-[360px] max-w-[92vw] items-start gap-3 overflow-hidden rounded-2xl border p-3.5 shadow-pop"
      style={{
        borderColor: mix(color, 30, 'var(--border)'),
        background: `linear-gradient(135deg, ${mix(color, 20, 'var(--popover)')}, var(--popover) 65%)`,
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -top-12 -left-12 size-32 rounded-full opacity-40 blur-2xl"
        style={{ background: color }}
      />
      <span className="relative grid size-10 shrink-0 place-items-center" style={{ color }}>
        <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="20" cy="20" r="18" fill="none" stroke={mix(color, 20)} strokeWidth="2.5" />
          {kind !== 'loading' && (
            <motion.circle
              cx="20"
              cy="20"
              r="18"
              fill="none"
              stroke={color}
              strokeWidth="2.5"
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray={1}
              initial={{ strokeDashoffset: 0 }}
              animate={{ strokeDashoffset: 1 }}
              transition={{ duration: duration / 1000, ease: 'linear' }}
            />
          )}
        </svg>
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.12, type: 'spring', stiffness: 500, damping: 14 }}
        >
          <KindIcon kind={kind} className="size-[18px]" />
        </motion.span>
      </span>
      <div className="relative min-w-0 pt-0.5">
        <p className="text-sm font-semibold">{title}</p>
        {description && <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>}
      </div>
    </motion.div>
  );
}

/* 4. BOLD: a solid colour pill that pops in with a big bounce. Loud, hard to miss. */
function Bold({ kind, title, description }: Props) {
  const { color } = TONE[kind];
  return (
    <motion.div
      initial={{ scale: 0.3, y: -36, rotate: -5, opacity: 0 }}
      animate={{ scale: 1, y: 0, rotate: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 600, damping: 13 }}
      className="relative flex items-center gap-2.5 rounded-full py-2.5 pr-5 pl-3.5 text-white shadow-pop"
      style={{ background: kind === 'loading' ? 'var(--foreground)' : color, maxWidth: '92vw' }}
    >
      {kind === 'success' &&
        [-1, 0, 1].map((n) => (
          <motion.span
            key={n}
            aria-hidden
            className="absolute -top-1 left-4 text-xs"
            initial={{ y: 0, x: 0, opacity: 1, scale: 0.5 }}
            animate={{ y: -22, x: n * 14, opacity: 0, scale: 1.1 }}
            transition={{ delay: 0.15, duration: 0.7, ease: 'easeOut' }}
          >
            ✦
          </motion.span>
        ))}
      <motion.span
        initial={{ rotate: -90, scale: 0 }}
        animate={{ rotate: 0, scale: 1 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 500, damping: 12 }}
      >
        <KindIcon kind={kind} className="size-5" />
      </motion.span>
      <div className="min-w-0">
        <p className="text-sm leading-tight font-semibold">{title}</p>
        {description && <p className="text-xs opacity-90">{description}</p>}
      </div>
    </motion.div>
  );
}

/* 5. TICKET: a notification card with an avatar, text and actions. Slides down with a slight tilt. */
function Ticket({ kind, title, description, id }: Props) {
  const { color } = TONE[kind];
  return (
    <motion.div
      initial={{ y: -70, opacity: 0, rotate: -2 }}
      animate={{ y: 0, opacity: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 20 }}
      className="bg-popover w-[380px] max-w-[92vw] overflow-hidden rounded-2xl border shadow-pop"
    >
      <div className="h-1" style={{ background: color }} />
      <div className="flex gap-3 p-3.5">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-xl"
          style={{ background: mix(color, 16), color }}
        >
          <KindIcon kind={kind} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          {description && <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>}
          <div className="mt-2.5 flex gap-2">
            <Button size="xs" onClick={() => toast.dismiss(id)}>
              Undo
            </Button>
            <Button size="xs" variant="ghost" onClick={() => toast.dismiss(id)}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* 6. JELLY: a round bubble that wobbles, then stretches out to show its message. */
function Jelly({ kind, title, description }: Props) {
  const { color } = TONE[kind];
  return (
    <motion.div
      initial={{ scale: 0, y: -30 }}
      animate={{ scale: [0, 1.25, 0.9, 1.06, 1], y: 0, rotate: [-14, 8, -4, 2, 0] }}
      transition={{ duration: 0.75, times: [0, 0.4, 0.62, 0.82, 1], ease: 'easeOut' }}
      className="bg-popover flex items-center gap-3 rounded-full border py-2 pr-5 pl-2 shadow-pop"
      style={{ borderColor: mix(color, 35, 'var(--border)'), maxWidth: '92vw' }}
    >
      <motion.span
        animate={{ scale: [1, 1.12, 1] }}
        transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
        className="grid size-9 shrink-0 place-items-center rounded-full text-white"
        style={{ background: color }}
      >
        <KindIcon kind={kind} className="size-[18px]" />
      </motion.span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-muted-foreground text-xs">{description}</p>}
      </div>
    </motion.div>
  );
}

const STYLES: {
  id: string;
  name: string;
  blurb: string;
  render: (p: Props) => ReactNode;
}[] = [
  { id: 'drop', name: 'Drop', blurb: 'A water drop falls, lands and spreads into the pill.', render: Drop },
  { id: 'island', name: 'Island', blurb: 'Dark pill that starts as a dot and stretches open.', render: Island },
  { id: 'glass', name: 'Glass', blurb: 'Tinted card with a glow and a countdown ring.', render: Glass },
  { id: 'bold', name: 'Bold', blurb: 'Solid colour, big bounce, sparkles on success.', render: Bold },
  { id: 'ticket', name: 'Ticket', blurb: 'Card with actions. Slides down with a tilt.', render: Ticket },
  { id: 'jelly', name: 'Jelly', blurb: 'Round bubble that wobbles like jelly.', render: Jelly },
];

export function ToastLab() {
  const [kind, setKind] = useState<Kind>('success');
  const [title, setTitle] = useState('Profile updated');
  const [description, setDescription] = useState('Your changes are live for everyone.');
  const [duration, setDuration] = useState(3600);

  const show = (render: (p: Props) => ReactNode, k: Kind = kind, t = title, d = description) =>
    toast.custom((id) => <>{render({ kind: k, title: t, description: d, duration, id })}</>, {
      duration: k === 'loading' ? Infinity : duration,
      position: 'top-center',
    });

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-display">Toast lab</h1>
          <p className="text-muted-foreground text-sm">
            Fire each style and compare. Dev only. Toasts appear at the top centre.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <section className="bg-card space-y-4 rounded-xl border p-5">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Type">
          {(Object.keys(TONE) as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors',
                kind === k ? 'bg-foreground text-background border-transparent' : 'hover:bg-accent',
              )}
            >
              <span className="size-2 rounded-full" style={{ background: TONE[k].color }} />
              {TONE[k].label}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_8rem]">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-label="Description (optional)"
            placeholder="Description (optional)"
          />
          <Input
            type="number"
            min={1000}
            step={500}
            value={duration}
            onChange={(e) => setDuration(Math.max(1000, Number(e.target.value) || 3600))}
            aria-label="Duration in milliseconds"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              const fn = kind === 'loading' ? toast.loading : (toast[kind] as typeof toast.success);
              fn(title, { description, duration });
            }}
          >
            Plain Sonner (old default)
          </Button>
          <Button variant="ghost" onClick={() => toast.dismiss()}>
            Dismiss all
          </Button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STYLES.map((s) => (
          <div key={s.id} className="bg-card flex flex-col gap-3 rounded-xl border p-4">
            <div>
              <h2 className="text-heading flex items-center gap-1.5">
                <Sparkles className="text-primary size-4" aria-hidden /> {s.name}
              </h2>
              <p className="text-muted-foreground text-sm">{s.blurb}</p>
            </div>
            <div className="mt-auto flex gap-2">
              <Button size="sm" onClick={() => show(s.render)}>
                Show
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  show(s.render, 'success', 'Saved', '');
                  setTimeout(() => show(s.render, 'info', 'Syncing', 'Two new messages'), 350);
                  setTimeout(() => show(s.render, 'error', 'Could not send', 'Check your connection'), 700);
                }}
              >
                Stack of 3
              </Button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
