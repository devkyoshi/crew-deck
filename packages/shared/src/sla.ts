import { PRIORITIES, type Priority } from './index';

/** Response and resolve targets for one priority, in minutes (business hours or wall clock). */
export interface SlaTarget {
  responseMinutes: number;
  resolveMinutes: number;
}

/** A service desk's targets, kept on the space's board settings. */
export interface SlaPolicy {
  /** Count only the workspace's working hours, or the plain clock. */
  businessHours: boolean;
  targets: Record<Priority, SlaTarget>;
}

export const MAX_SLA_MINUTES = 60 * 24 * 90;

export const DEFAULT_SLA: SlaPolicy = {
  businessHours: true,
  targets: {
    highest: { responseMinutes: 30, resolveMinutes: 4 * 60 },
    high: { responseMinutes: 60, resolveMinutes: 8 * 60 },
    medium: { responseMinutes: 4 * 60, resolveMinutes: 24 * 60 },
    low: { responseMinutes: 8 * 60, resolveMinutes: 3 * 24 * 60 },
    lowest: { responseMinutes: 24 * 60, resolveMinutes: 5 * 24 * 60 },
  },
};

/** Whether a stored value is a usable policy (every priority has two positive, bounded targets). */
export function isSlaPolicy(v: unknown): v is SlaPolicy {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<SlaPolicy>;
  if (typeof p.businessHours !== 'boolean' || !p.targets) return false;
  return PRIORITIES.every((k) => {
    const t = p.targets?.[k];
    return (
      !!t &&
      Number.isInteger(t.responseMinutes) &&
      Number.isInteger(t.resolveMinutes) &&
      t.responseMinutes > 0 &&
      t.resolveMinutes > 0 &&
      t.responseMinutes <= MAX_SLA_MINUTES &&
      t.resolveMinutes <= MAX_SLA_MINUTES
    );
  });
}

/**
 * ok: running, plenty of time. due_soon: under an hour left. breached: the deadline passed (or it was
 * met late). met: done in time. none: no target applies.
 */
export type SlaState = 'none' | 'ok' | 'due_soon' | 'breached' | 'met';

export const SLA_SOON_MS = 60 * 60_000;

type When = Date | string | null | undefined;
const ms = (d: When) => (d ? new Date(d).getTime() : null);

/** State of one clock: a deadline, and when (if ever) it was satisfied. */
export function slaClockState(due: When, doneAt: When, now: Date = new Date()): SlaState {
  const dueMs = ms(due);
  if (dueMs === null) return 'none';
  const doneMs = ms(doneAt);
  if (doneMs !== null) return doneMs <= dueMs ? 'met' : 'breached';
  const left = dueMs - now.getTime();
  if (left < 0) return 'breached';
  return left <= SLA_SOON_MS ? 'due_soon' : 'ok';
}

export interface TicketSlaFields {
  slaResponseDueAt?: When;
  slaResolveDueAt?: When;
  firstResponseAt?: When;
  resolvedAt?: When;
}

export function ticketSla(t: TicketSlaFields, now: Date = new Date()) {
  return {
    response: slaClockState(t.slaResponseDueAt, t.firstResponseAt, now),
    resolve: slaClockState(t.slaResolveDueAt, t.resolvedAt, now),
  };
}
