'use client';

import type { ComponentType } from 'react';
import {
  Briefcase,
  Check,
  Code2,
  Cog,
  FlaskConical,
  HardHat,
  Headset,
  KanbanSquare,
  Landmark,
  Layers,
  Megaphone,
  MessagesSquare,
  Palette,
  Scale,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  suggestedUsageFor,
  USAGE_OPTIONS,
  WORK_TYPES,
  WORKSPACE_TEMPLATES,
  type UsageOption,
  type WorkType,
} from '@crew-deck/shared';
import { cn } from '@/lib/utils';

type Icon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

/** Icon and tint for each kind of work. Tints are decorative; the label always carries the meaning. */
export const WORK_TYPE_VISUALS: Record<WorkType, { icon: Icon; tint: string }> = {
  software: { icon: Code2, tint: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300' },
  product: { icon: Layers, tint: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
  marketing: { icon: Megaphone, tint: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300' },
  design: { icon: Palette, tint: 'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300' },
  project_mgmt: { icon: KanbanSquare, tint: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' },
  operations: { icon: Cog, tint: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  it_support: { icon: Headset, tint: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300' },
  hr: { icon: Users, tint: 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300' },
  customer_service: { icon: MessagesSquare, tint: 'bg-lime-100 text-lime-700 dark:bg-lime-500/20 dark:text-lime-300' },
  legal: { icon: Scale, tint: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300' },
  finance: { icon: Landmark, tint: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300' },
  sales: { icon: TrendingUp, tint: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300' },
  data_science: { icon: FlaskConical, tint: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300' },
  construction: { icon: HardHat, tint: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300' },
  other: { icon: Sparkles, tint: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300' },
};

export const workTypeLabel = (t: string | null | undefined) =>
  t && t in WORKSPACE_TEMPLATES ? WORKSPACE_TEMPLATES[t as WorkType].label : 'Not set';

/** A compact, wrapping pill: many choices fit on a few lines instead of a long column of cards. */
const chip =
  'border-border bg-background hover:border-primary/50 hover:bg-muted/40 focus-visible:ring-primary/40 has-[:focus-visible]:ring-primary/40 inline-flex items-center gap-2 rounded-full border py-1.5 pr-3.5 pl-2 text-left text-sm font-medium transition-colors focus-visible:ring-2 has-[:focus-visible]:ring-2 focus-visible:outline-hidden';
const chipOn = 'border-primary bg-primary/10 text-foreground';

/** "What kind of work does your company do?" Pick all that apply, shown as a grid of cards. */
export function WorkTypeMultiPicker({
  value,
  onChange,
  idPrefix = 'work-type',
}: {
  value: WorkType[];
  onChange: (next: WorkType[]) => void;
  idPrefix?: string;
}) {
  const toggle = (type: WorkType) =>
    onChange(value.includes(type) ? value.filter((t) => t !== type) : [...value, type]);
  return (
    <div role="group" aria-label="What kind of work does your company do?" className="flex flex-wrap gap-2">
      {WORK_TYPES.map((type) => {
        const { icon: TypeIcon, tint } = WORK_TYPE_VISUALS[type];
        const selected = value.includes(type);
        return (
          <button
            key={type}
            type="button"
            role="checkbox"
            aria-checked={selected}
            id={`${idPrefix}-${type}`}
            data-testid={`work-type-${type}`}
            title={WORKSPACE_TEMPLATES[type].blurb}
            onClick={() => toggle(type)}
            className={cn(chip, selected && chipOn)}
          >
            <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full', tint)}>
              {selected ? <Check className="size-3.5" aria-hidden /> : <TypeIcon className="size-3.5" aria-hidden />}
            </span>
            {WORKSPACE_TEMPLATES[type].label}
          </button>
        );
      })}
    </div>
  );
}

/** "Software development, Marketing and Sales". */
export const workTypesLabel = (types: readonly string[]) =>
  types.length ? types.map(workTypeLabel).join(', ') : 'Not set';

/** Usage options worth showing for a set of types: their suggestions first, then everything else. */
export function usageOptionsFor(types: readonly WorkType[]): UsageOption[] {
  if (!types.length) return [...USAGE_OPTIONS];
  const suggested = suggestedUsageFor(types);
  const first = suggested
    .map((key) => USAGE_OPTIONS.find((o) => o.key === key))
    .filter((o): o is UsageOption => !!o);
  const rest = USAGE_OPTIONS.filter((o) => !suggested.includes(o.key));
  return [...first, ...rest];
}

/** "How does your team plan to use it?" Several choices, pre-checked from the work type. */
export function UsagePicker({
  types,
  value,
  onChange,
  showAll = false,
}: {
  types: WorkType[];
  value: string[];
  onChange: (next: string[]) => void;
  /** Show every option, not just the suggested ones. */
  showAll?: boolean;
}) {
  const suggested = suggestedUsageFor(types);
  const options = showAll ? usageOptionsFor(types) : usageOptionsFor(types).slice(0, Math.max(suggested.length, 6));
  const toggle = (key: string) =>
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  return (
    <div role="group" aria-label="How does your team plan to use it?" className="flex flex-wrap gap-2">
      {options.map((o) => {
        const checked = value.includes(o.key);
        return (
          <label
            key={o.key}
            title={o.hint}
            className={cn(chip, 'cursor-pointer pl-3', checked && chipOn)}
            data-testid={`usage-${o.key}`}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={checked}
              onChange={() => toggle(o.key)}
              aria-describedby={`usage-hint-${o.key}`}
            />
            {checked && <Check className="text-primary size-3.5 shrink-0" aria-hidden />}
            <span>{o.label}</span>
            {o.status !== 'built' && (
              <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                Coming soon
              </span>
            )}
            <span id={`usage-hint-${o.key}`} className="sr-only">
              {o.hint}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function WorkTypeBadge({ type }: { type: string | null | undefined }) {
  const visual = type && type in WORK_TYPE_VISUALS ? WORK_TYPE_VISUALS[type as WorkType] : null;
  const Visual = visual?.icon ?? Briefcase;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={cn('flex size-5 items-center justify-center rounded', visual?.tint ?? 'bg-muted')}>
        <Visual className="size-3" aria-hidden />
      </span>
      {workTypeLabel(type)}
    </span>
  );
}
