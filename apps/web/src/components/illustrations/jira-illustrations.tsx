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
        'relative overflow-hidden rounded-lg border border-border/70 bg-card p-4 shadow-sm transition-all',
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
          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
            Sprint 14
          </span>
        </div>
        <div className="flex -space-x-1.5">
          <span className="flex size-5 items-center justify-center rounded-full bg-info-soft text-xs font-bold text-info-soft-foreground ring-2 ring-card">
            JD
          </span>
          <span className="flex size-5 items-center justify-center rounded-full bg-success-soft text-xs font-bold text-success-soft-foreground ring-2 ring-card">
            SK
          </span>
          <span className="flex size-5 items-center justify-center rounded-full bg-warning-soft text-xs font-bold text-warning-soft-foreground ring-2 ring-card">
            AL
          </span>
        </div>
      </div>

      {/* Columns Grid */}
      <div className="grid grid-cols-3 gap-2.5">
        {/* TO DO Column */}
        <div className="rounded-lg bg-muted/40 p-2 border border-border/40">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
              To Do
            </span>
            <span className="rounded-full bg-muted px-1.5 py-0.2 text-xs font-medium text-muted-foreground">
              2
            </span>
          </div>
          <div className="space-y-1.5">
            <div className="rounded-md border border-border/60 bg-card p-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-mono text-muted-foreground">CRW-108</span>
                <span className="size-1.5 rounded-full bg-info" />
              </div>
              <p className="text-xs font-medium leading-snug line-clamp-1">Design user onboarding</p>
              <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                <span className="rounded-sm bg-info-soft px-1 text-info-soft-foreground font-medium">Design</span>
              </div>
            </div>
            <div className="rounded-md border border-border/60 bg-card p-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-mono text-muted-foreground">CRW-109</span>
                <span className="size-1.5 rounded-full bg-muted-foreground/40" />
              </div>
              <p className="text-xs font-medium leading-snug line-clamp-1">Add CSV importer</p>
            </div>
          </div>
        </div>

        {/* IN PROGRESS Column */}
        <div className="rounded-lg bg-muted/40 p-2 border border-border/40">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-semibold tracking-wide uppercase text-info-soft-foreground ">
              In Progress
            </span>
            <span className="rounded-full bg-info-soft px-1.5 py-0.2 text-xs font-medium text-info-soft-foreground ">
              1
            </span>
          </div>
          <div className="space-y-1.5">
            <div className="rounded-md border border-info/30 bg-card p-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-info/20">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-mono text-info-soft-foreground ">CRW-105</span>
                <span className="size-1.5 rounded-full bg-warning animate-pulse" />
              </div>
              <p className="text-xs font-medium leading-snug line-clamp-1">Multi-step auth flow</p>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="rounded-sm bg-warning-soft px-1 text-xs text-warning-soft-foreground font-medium">P1 High</span>
                <span className="size-4 rounded-full bg-primary text-xs font-bold text-primary-foreground flex items-center justify-center">
                  ME
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* DONE Column */}
        <div className="rounded-lg bg-muted/40 p-2 border border-border/40">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-semibold tracking-wide uppercase text-success-soft-foreground ">
              Done
            </span>
            <span className="rounded-full bg-success-soft px-1.5 py-0.2 text-xs font-medium text-success-soft-foreground ">
              2
            </span>
          </div>
          <div className="space-y-1.5">
            <div className="rounded-md border border-border/60 bg-card/80 p-2 opacity-90">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-mono text-muted-foreground line-through">CRW-101</span>
                <CheckCircle2 className="size-3 text-success-soft-foreground " />
              </div>
              <p className="text-xs font-medium leading-snug line-clamp-1 text-muted-foreground">Setup tenant database</p>
            </div>
            <div className="rounded-md border border-border/60 bg-card/80 p-2 opacity-90">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-mono text-muted-foreground line-through">CRW-102</span>
                <CheckCircle2 className="size-3 text-success-soft-foreground " />
              </div>
              <p className="text-xs font-medium leading-snug line-clamp-1 text-muted-foreground">Daily checkin cards</p>
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
        'rounded-lg border border-border/70 bg-card p-4 shadow-sm text-left',
        className,
      )}
      aria-hidden="true"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-success/10 text-success-soft-foreground">
            <UserCheck className="size-4" />
          </span>
          <div>
            <h4 className="text-xs font-semibold text-foreground">Today's Check-ins</h4>
            <p className="text-xs text-muted-foreground">8 in office • 4 remote</p>
          </div>
        </div>
        <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success-soft-foreground ">
          92% Active
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-lg bg-muted/40 p-2 border border-border/30">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <span className="flex size-7 items-center justify-center rounded-full bg-info/20 text-xs font-bold text-info-soft-foreground">
                SC
              </span>
              <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-success ring-2 ring-card" />
            </div>
            <div>
              <p className="text-xs font-medium leading-none">Sarah Chen</p>
              <p className="text-xs text-muted-foreground mt-0.5">In Office • London HQ</p>
            </div>
          </div>
          <span className="text-xs font-medium text-success-soft-foreground bg-success/10 px-2 py-0.5 rounded-sm">
            9:02 AM
          </span>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-muted/40 p-2 border border-border/30">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <span className="flex size-7 items-center justify-center rounded-full bg-violet/20 text-xs font-bold text-violet-soft-foreground">
                MK
              </span>
              <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-info ring-2 ring-card" />
            </div>
            <div>
              <p className="text-xs font-medium leading-none">Marcus Kim</p>
              <p className="text-xs text-muted-foreground mt-0.5">Remote • Working on Sprint</p>
            </div>
          </div>
          <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-sm">
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
    blue: 'bg-info/10 text-info-soft-foreground border-info/20',
    emerald: 'bg-success/10 text-success-soft-foreground border-success/20',
    amber: 'bg-warning/10 text-warning-soft-foreground border-warning/20',
    purple: 'bg-violet/10 text-violet-soft-foreground border-violet/20',
  };

  return (
    <div
      className={cn(
        'flex size-11 items-center justify-center rounded-lg border shadow-xs',
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
        <div className="absolute -top-1 left-1 z-20 rounded-full bg-violet-soft border border-violet/80 px-2.5 py-0.5 text-xs font-semibold text-violet-soft-foreground shadow-xs">
          Thanks!
        </div>

        {/* Love it! Speech Bubble */}
        <div className="absolute -top-1 right-1 z-20 rounded-full bg-violet-soft border border-violet/80 px-2.5 py-0.5 text-xs font-semibold text-violet-soft-foreground shadow-xs">
          Love it!
        </div>

        {/* Avatar 1 */}
        <div className="absolute left-8 top-3 size-10 rounded-full ring-2 ring-white bg-warning-soft flex items-center justify-center overflow-hidden shadow-xs">
          <svg viewBox="0 0 40 40" className="size-full" fill="none">
            <circle cx="20" cy="15" r="7" fill="#F59E0B" />
            <path d="M9 36c0-6 4.9-11 11-11s11 5 11 11" fill="#D97706" />
          </svg>
        </div>

        {/* Avatar 2 (overlapping) */}
        <div className="absolute right-8 top-3 size-10 rounded-full ring-2 ring-white bg-success-soft flex items-center justify-center overflow-hidden shadow-xs">
          <svg viewBox="0 0 40 40" className="size-full" fill="none">
            <circle cx="20" cy="15" r="7" fill="#10B981" />
            <path d="M9 36c0-6 4.9-11 11-11s11 5 11 11" fill="#059669" />
          </svg>
        </div>
      </div>
    </div>
  );
}

