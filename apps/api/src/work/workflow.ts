import { z } from 'zod';
import { RESOLUTIONS, type Resolution } from '@crew-deck/shared';
import type { TenantDb } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import type { StatusCategory } from '../db/types.js';

/**
 * Optional rules about which status an item may move to from which. Off by default (any to any), so
 * nothing changes until a space admin turns it on. A status that is not listed as a source is
 * unrestricted, which keeps newly added statuses usable.
 */
export const workflowSchema = z.object({
  restricted: z.boolean(),
  /** Source status id -> status ids it may move to. */
  transitions: z.record(z.string().uuid(), z.array(z.string().uuid()).max(30)),
});
export type Workflow = z.infer<typeof workflowSchema>;

export const OPEN_WORKFLOW: Workflow = { restricted: false, transitions: {} };

export function readWorkflow(settings: unknown): Workflow {
  const parsed = workflowSchema.safeParse((settings as { workflow?: unknown } | null)?.workflow);
  return parsed.success ? parsed.data : OPEN_WORKFLOW;
}

export async function loadWorkflow(t: TenantDb, spaceId: string): Promise<Workflow> {
  const board = await t.boards.findOne({ spaceId });
  return readWorkflow(board?.settings);
}

export function transitionAllowed(w: Workflow, from: string, to: string) {
  if (!w.restricted || from === to) return true;
  const allowed = w.transitions[from];
  return !allowed || allowed.includes(to);
}

/** Throws a 422 naming both statuses when the space's rules do not allow the move. */
export function assertTransition(w: Workflow, from: { id: string; name: string }, to: { id: string; name: string }) {
  if (!transitionAllowed(w, from.id, to.id)) {
    throw new AppError(422, 'transition_not_allowed', `This space does not allow moving from ${from.name} to ${to.name}`, {
      statusId: `Not allowed from ${from.name}`,
    });
  }
}

/** The resolution an item carries after moving to a status of `category`. */
export function resolutionFor(
  category: StatusCategory,
  current: Resolution | null | undefined,
  requested?: Resolution | null,
): Resolution | null {
  if (category !== 'done') return null;
  return requested ?? current ?? 'done';
}

export const resolutionSchema = z.enum(RESOLUTIONS);
