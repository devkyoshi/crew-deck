'use client';

import {
  FEATURE_GROUPS,
  FEATURE_PRESETS,
  normalizeFeatures,
  type FeatureInfo,
  type SpaceFeature,
} from '@crew-deck/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { useHasFeature } from '@/lib/plans';
import { cn } from '@/lib/utils';

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Whether this workspace's plan lets a space switch the feature on. */
function useUnlocked() {
  const sprints = useHasFeature('scrum_sprints');
  const tickets = useHasFeature('service_desk');
  return (f: FeatureInfo) => (f.plan === 'scrum_sprints' ? sprints : f.plan === 'service_desk' ? tickets : true);
}

/**
 * Pick what a space has: quick-start presets, then the features in groups. Ticking a group ticks every
 * feature in it (and shows a dash when only some are on). No boxes around anything: it sits on the page.
 * Features the plan does not include stay visible but cannot be turned on.
 */
export function FeaturePicker({
  value,
  onChange,
  idPrefix = 'feature',
  disabled = false,
}: {
  value: SpaceFeature[];
  onChange: (next: SpaceFeature[]) => void;
  idPrefix?: string;
  disabled?: boolean;
}) {
  const unlocked = useUnlocked();
  const set = (next: SpaceFeature[]) => onChange(normalizeFeatures(next));
  const toggle = (f: SpaceFeature) => set(value.includes(f) ? value.filter((x) => x !== f) : [...value, f]);

  return (
    <div className="space-y-6">
      <div role="group" aria-label="Quick start" className="space-y-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Quick start</p>
        <div className="flex flex-wrap gap-2">
          {FEATURE_PRESETS.map((p) => {
            const locked = p.features.some((k) => {
              const info = FEATURE_GROUPS.flatMap((g) => g.features).find((x) => x.key === k)!;
              return !unlocked(info);
            });
            const on = sameSet(value, p.features);
            return (
              <button
                key={p.id}
                type="button"
                disabled={disabled || locked}
                aria-pressed={on}
                title={locked ? `${p.hint} (needs a higher plan)` : p.hint}
                data-testid={`preset-${p.id}`}
                onClick={() => set(p.features)}
                className={cn(
                  'hover:bg-accent/60 rounded-full border px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
                  on && 'border-primary bg-primary/10 font-medium',
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="divide-y">
        {FEATURE_GROUPS.map((g) => {
          const usable = g.features.filter(unlocked);
          const onCount = usable.filter((f) => value.includes(f.key)).length;
          const state: boolean | 'indeterminate' =
            usable.length > 0 && onCount === usable.length ? true : onCount > 0 ? 'indeterminate' : false;
          const gid = `${idPrefix}-group-${g.id}`;
          return (
            <section key={g.id} aria-labelledby={`${gid}-label`} className="space-y-3 py-4 first:pt-0">
              <div className="flex items-start gap-3">
                <Checkbox
                  id={gid}
                  className="mt-0.5"
                  checked={state}
                  disabled={disabled || usable.length === 0}
                  data-testid={`feature-group-${g.id}`}
                  onCheckedChange={() => {
                    const keys = usable.map((f) => f.key);
                    set(state === true ? value.filter((x) => !keys.includes(x)) : [...value, ...keys]);
                  }}
                />
                <label htmlFor={gid} className="cursor-pointer">
                  <span id={`${gid}-label`} className="block text-sm font-semibold">
                    {g.label}
                  </span>
                  <span className="text-muted-foreground block text-xs">{g.hint}</span>
                </label>
              </div>
              <ul className="space-y-2.5 pl-7">
                {g.features.map((f) => {
                  const fid = `${idPrefix}-${f.key}`;
                  const locked = !unlocked(f);
                  return (
                    <li key={f.key} className="flex items-start gap-3">
                      <Checkbox
                        id={fid}
                        className="mt-0.5"
                        checked={value.includes(f.key)}
                        disabled={disabled || (locked && !value.includes(f.key))}
                        data-testid={`feature-${f.key}`}
                        onCheckedChange={() => toggle(f.key)}
                      />
                      <label htmlFor={fid} className="cursor-pointer">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {f.label}
                          {locked && (
                            <span className="bg-secondary rounded-full px-2 py-0.5 text-xs font-normal">Team plan</span>
                          )}
                        </span>
                        <span className="text-muted-foreground block text-xs">{f.hint}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
