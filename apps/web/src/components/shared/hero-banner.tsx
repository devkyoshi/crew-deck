import type { ReactNode } from 'react';

/** Greeting banner with a soft gradient and an abstract illustration (no external images). */
export function HeroBanner({
  eyebrow,
  title,
  badge,
}: {
  eyebrow: string;
  title: string;
  badge?: ReactNode;
}) {
  return (
    <section className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-sky-100 via-blue-100 to-indigo-100 p-6 sm:p-8 dark:from-sky-950 dark:via-blue-950 dark:to-indigo-950">
      <div className="relative z-10 max-w-md space-y-1">
        <p className="text-muted-foreground text-sm">{eyebrow}</p>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      </div>
      {badge && <div className="relative z-10 mt-10">{badge}</div>}
      <svg
        aria-hidden
        viewBox="0 0 480 220"
        className="pointer-events-none absolute -right-6 -bottom-4 -z-0 h-[115%] opacity-90"
        fill="none"
      >
        <circle cx="360" cy="70" r="96" className="fill-sky-300/50 dark:fill-sky-400/15" />
        <circle cx="430" cy="170" r="70" className="fill-indigo-300/50 dark:fill-indigo-400/15" />
        <rect
          x="250"
          y="110"
          width="150"
          height="86"
          rx="18"
          className="fill-white/80 dark:fill-white/10"
        />
        <rect x="266" y="126" width="64" height="8" rx="4" className="fill-sky-400/70" />
        <rect
          x="266"
          y="144"
          width="110"
          height="8"
          rx="4"
          className="fill-slate-300/80 dark:fill-white/20"
        />
        <rect
          x="266"
          y="162"
          width="84"
          height="8"
          rx="4"
          className="fill-slate-300/80 dark:fill-white/20"
        />
        <rect
          x="300"
          y="40"
          width="110"
          height="64"
          rx="16"
          className="fill-white/90 dark:fill-white/15"
        />
        <circle cx="326" cy="72" r="14" className="fill-amber-300" />
        <rect
          x="348"
          y="62"
          width="48"
          height="8"
          rx="4"
          className="fill-slate-300/90 dark:fill-white/25"
        />
        <rect
          x="348"
          y="78"
          width="32"
          height="8"
          rx="4"
          className="fill-slate-200 dark:fill-white/15"
        />
      </svg>
    </section>
  );
}
