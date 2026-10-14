import React from 'react';
import {
  CheckCircle2,
  Kanban,
  UserCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Jira-inspired vector illustration of a modern Kanban board.
 * Shows status columns (TO DO, IN PROGRESS, DONE) with realistic ticket cards,
 * priority indicators, and tags. Perfectly responsive and theme-aware (supports light & dark).
 */
export function JiraKanbanIllustration({
  className,
  workspaceName = 'Crew Deck',
}: {
  className?: string;
  workspaceName?: string;
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-border/70 bg-card p-4 shadow-sm transition-all',
        className,
      )}
      aria-hidden="true"
    >
      {/* Mini Board Header */}
      <div className="mb-3.5 flex items-center justify-between border-b border-border/50 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Kanban className="size-3.5" />
          </span>
          <span className="text-xs font-semibold tracking-tight text-foreground truncate max-w-[140px]">
            {workspaceName}
          </span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            Sprint 14
          </span>
        </div>
        <div className="flex -space-x-1.5">
          <span className="flex size-5 items-center justify-center rounded-full bg-blue-100 text-[9px] font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-300 ring-2 ring-card">
            JD
          </span>
          <span className="flex size-5 items-center justify-center rounded-full bg-emerald-100 text-[9px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 ring-2 ring-card">
            SK
          </span>
          <span className="flex size-5 items-center justify-center rounded-full bg-amber-100 text-[9px] font-bold text-amber-900 dark:bg-amber-950 dark:text-amber-300 ring-2 ring-card">
            AL
          </span>
        </div>
      </div>

      {/* Columns Grid */}
      <div className="grid grid-cols-3 gap-2.5">
        {/* TO DO Column */}
        <div className="rounded-lg bg-muted/40 p-2 border border-border/40">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[10px] font-semibold tracking-wide uppercase text-muted-foreground">
              To Do
            </span>
            <span className="rounded-full bg-muted px-1.5 py-0.2 text-[9px] font-medium text-muted-foreground">
              2
            </span>
          </div>
          <div className="space-y-1.5">
            <div className="rounded-md border border-border/60 bg-card p-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[9px] font-mono text-muted-foreground">CRW-108</span>
                <span className="size-1.5 rounded-full bg-blue-500" />
              </div>
              <p className="text-[11px] font-medium leading-snug line-clamp-1">Design user onboarding</p>
              <div className="mt-1.5 flex items-center gap-1 text-[9px] text-muted-foreground">
                <span className="rounded bg-blue-100 dark:bg-blue-950 px-1 text-blue-800 dark:text-blue-300 font-medium">Design</span>
              </div>
            </div>
            <div className="rounded-md border border-border/60 bg-card p-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[9px] font-mono text-muted-foreground">CRW-109</span>
                <span className="size-1.5 rounded-full bg-slate-400" />
              </div>
              <p className="text-[11px] font-medium leading-snug line-clamp-1">Add CSV importer</p>
            </div>
          </div>
        </div>

        {/* IN PROGRESS Column */}
        <div className="rounded-lg bg-muted/40 p-2 border border-border/40">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[10px] font-semibold tracking-wide uppercase text-blue-700 dark:text-blue-400">
              In Progress
            </span>
            <span className="rounded-full bg-blue-100 dark:bg-blue-950 px-1.5 py-0.2 text-[9px] font-medium text-blue-800 dark:text-blue-300">
              1
            </span>
          </div>
          <div className="space-y-1.5">
            <div className="rounded-md border border-blue-500/30 bg-card p-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-blue-500/20">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[9px] font-mono text-blue-700 dark:text-blue-400">CRW-105</span>
                <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
              </div>
              <p className="text-[11px] font-medium leading-snug line-clamp-1">Multi-step auth flow</p>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="rounded bg-amber-100 dark:bg-amber-950 px-1 text-[9px] text-amber-900 dark:text-amber-300 font-medium">P1 High</span>
                <span className="size-4 rounded-full bg-primary text-[8px] font-bold text-primary-foreground flex items-center justify-center">
                  ME
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* DONE Column */}
        <div className="rounded-lg bg-muted/40 p-2 border border-border/40">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[10px] font-semibold tracking-wide uppercase text-emerald-700 dark:text-emerald-400">
              Done
            </span>
            <span className="rounded-full bg-emerald-100 dark:bg-emerald-950 px-1.5 py-0.2 text-[9px] font-medium text-emerald-800 dark:text-emerald-300">
              2
            </span>
          </div>
          <div className="space-y-1.5">
            <div className="rounded-md border border-border/60 bg-card/80 p-2 opacity-90">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[9px] font-mono text-muted-foreground line-through">CRW-101</span>
                <CheckCircle2 className="size-3 text-emerald-700 dark:text-emerald-400" />
              </div>
              <p className="text-[11px] font-medium leading-snug line-clamp-1 text-muted-foreground">Setup tenant database</p>
            </div>
            <div className="rounded-md border border-border/60 bg-card/80 p-2 opacity-90">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[9px] font-mono text-muted-foreground line-through">CRW-102</span>
                <CheckCircle2 className="size-3 text-emerald-700 dark:text-emerald-400" />
              </div>
              <p className="text-[11px] font-medium leading-snug line-clamp-1 text-muted-foreground">Daily checkin cards</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Jira-style interactive-like team collaboration and check-in preview widget.
 */
export function JiraTeamCheckinIllustration({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border/70 bg-card p-4 shadow-sm text-left',
        className,
      )}
      aria-hidden="true"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
            <UserCheck className="size-4" />
          </span>
          <div>
            <h4 className="text-xs font-semibold text-foreground">Today's Check-ins</h4>
            <p className="text-[10px] text-muted-foreground">8 in office • 4 remote</p>
          </div>
        </div>
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
          92% Active
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-lg bg-muted/40 p-2 border border-border/30">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <span className="flex size-7 items-center justify-center rounded-full bg-blue-500/20 text-xs font-bold text-blue-600">
                SC
              </span>
              <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-emerald-500 ring-2 ring-card" />
            </div>
            <div>
              <p className="text-xs font-medium leading-none">Sarah Chen</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">In Office • London HQ</p>
            </div>
          </div>
          <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
            9:02 AM
          </span>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-muted/40 p-2 border border-border/30">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <span className="flex size-7 items-center justify-center rounded-full bg-purple-500/20 text-xs font-bold text-purple-600">
                MK
              </span>
              <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-blue-500 ring-2 ring-card" />
            </div>
            <div>
              <p className="text-xs font-medium leading-none">Marcus Kim</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Remote • Working on Sprint</p>
            </div>
          </div>
          <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded">
            8:45 AM
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Jira-style spot illustration for features: Clean vector icons with soft background badge
 */
export function JiraSpotIcon({
  icon: Icon,
  color = 'blue',
}: {
  icon: React.ElementType;
  color?: 'blue' | 'emerald' | 'amber' | 'purple';
}) {
  const colorMap = {
    blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  };

  return (
    <div
      className={cn(
        'flex size-11 items-center justify-center rounded-xl border shadow-xs',
        colorMap[color],
      )}
    >
      <Icon className="size-5" />
    </div>
  );
}

/**
 * Friendly avatar bubbles from Reference 2: Clean floating avatar bubbles with speech tags
 */
export function FriendlyAvatarsIllustration({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-2 select-none', className)} aria-hidden="true">
      <div className="relative flex items-center justify-center h-16 w-40">
        {/* Thanks! Speech Bubble */}
        <div className="absolute -top-1 left-1 z-20 rounded-full bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/80 dark:border-indigo-800/80 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 shadow-xs">
          Thanks!
        </div>

        {/* Love it! Speech Bubble */}
        <div className="absolute -top-1 right-1 z-20 rounded-full bg-purple-50 dark:bg-purple-950/80 border border-purple-200/80 dark:border-purple-800/80 px-2.5 py-0.5 text-[11px] font-semibold text-purple-700 dark:text-purple-300 shadow-xs">
          Love it!
        </div>

        {/* Avatar 1 */}
        <div className="absolute left-8 top-3 size-10 rounded-full ring-2 ring-white dark:ring-zinc-950 bg-amber-100 dark:bg-amber-900/60 flex items-center justify-center overflow-hidden shadow-xs">
          <svg viewBox="0 0 40 40" className="size-full" fill="none">
            <circle cx="20" cy="15" r="7" fill="#F59E0B" />
            <path d="M9 36c0-6 4.9-11 11-11s11 5 11 11" fill="#D97706" />
          </svg>
        </div>

        {/* Avatar 2 (overlapping) */}
        <div className="absolute right-8 top-3 size-10 rounded-full ring-2 ring-white dark:ring-zinc-950 bg-emerald-100 dark:bg-emerald-900/60 flex items-center justify-center overflow-hidden shadow-xs">
          <svg viewBox="0 0 40 40" className="size-full" fill="none">
            <circle cx="20" cy="15" r="7" fill="#10B981" />
            <path d="M9 36c0-6 4.9-11 11-11s11 5 11 11" fill="#059669" />
          </svg>
        </div>
      </div>
    </div>
  );
}

