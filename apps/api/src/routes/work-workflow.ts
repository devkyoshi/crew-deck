import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { isSlaPolicy, MAX_CHECKLIST, MAX_SLA_MINUTES, PRIORITIES } from '@crew-deck/shared';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant, withTenantTx } from '../db/client.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { liveTouch } from '../lib/live.js';
import { can } from '../permissions/can.js';
import { assertWritable, listStatuses } from '../work/service.js';
import { loadSlaPolicy } from '../work/sla.js';
import { loadWorkflow, workflowSchema } from '../work/workflow.js';
import { resolveSpace, spaceCtx } from './spaces.js';

const idParam = z.object({ id: z.string().min(1).max(64) });
const templateBody = z.object({
  name: z.string().trim().min(1, 'Name the checklist').max(60),
  items: z.array(z.string().trim().min(1).max(200)).min(1, 'Add at least one entry').max(MAX_CHECKLIST),
});
const MAX_TEMPLATES = 20;
const minutes = z.number().int().min(1).max(MAX_SLA_MINUTES);
const slaBody = z.object({
  businessHours: z.boolean(),
  targets: z.object(
    Object.fromEntries(PRIORITIES.map((p) => [p, z.object({ responseMinutes: minutes, resolveMinutes: minutes })])) as Record<
      (typeof PRIORITIES)[number],
      z.ZodObject<{ responseMinutes: typeof minutes; resolveMinutes: typeof minutes }>
    >,
  ),
});

/** Workflow rules (which status may follow which) and checklist templates, both per space. */
export async function workWorkflowRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/spaces/:id/workflow', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const space = await resolveSpace(t, actor, req.params.id);
      // Statuses deleted since the rules were saved are dropped, so the editor can save them back as they are.
      const known = new Set((await listStatuses(t, space.id)).map((s) => s.id));
      const stored = await loadWorkflow(t, space.id);
      const transitions = Object.fromEntries(
        Object.entries(stored.transitions)
          .filter(([from]) => known.has(from))
          .map(([from, to]) => [from, to.filter((x) => known.has(x))]),
      );
      return { restricted: stored.restricted, transitions, permissions: { manage: can(actor, 'status.manage', spaceCtx(space)) && space.status === 'active' } };
    });
  });

  r.put(
    '/spaces/:id/workflow',
    { preHandler: requireAuth, schema: { params: idParam, body: workflowSchema } },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const space = await resolveSpace(t, actor, req.params.id);
        if (!can(actor, 'status.manage', spaceCtx(space))) throw forbidden();
        assertWritable(space);
        const known = new Set((await listStatuses(t, space.id)).map((s) => s.id));
        const used = Object.entries(req.body.transitions).flatMap(([from, to]) => [from, ...to]);
        if (used.some((id) => !known.has(id))) {
          throw new AppError(422, 'invalid_status', 'A status in the rules does not exist in this space');
        }
        // Moving a status to itself is always fine, so it is never stored.
        const transitions = Object.fromEntries(
          Object.entries(req.body.transitions).map(([from, to]) => [from, [...new Set(to)].filter((x) => x !== from)]),
        );
        const board = await t.boards.findOne({ spaceId: space.id });
        if (!board) throw notFound('Board');
        const workflow = { restricted: req.body.restricted, transitions };
        await t.boards.updateOne({ id: board.id }, { settings: { ...board.settings, workflow }, updatedAt: new Date() });
        liveTouch({ orgId: t.orgId, spaceId: space.id, kind: 'updated', itemId: null });
        return workflow;
      });
    },
  );

  // ---- Service desk targets ----------------------------------------------------------------------------------

  r.get('/spaces/:id/sla', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const space = await resolveSpace(t, actor, req.params.id);
      const board = await t.boards.findOne({ spaceId: space.id });
      return {
        enabled: board?.type === 'service',
        policy: await loadSlaPolicy(t, space.id),
        permissions: { manage: can(actor, 'board.manage', spaceCtx(space)) && space.status === 'active' },
      };
    });
  });

  // New targets apply to tickets raised from now on (and when a ticket's priority changes).
  r.put(
    '/spaces/:id/sla',
    { preHandler: requireAuth, schema: { params: idParam, body: slaBody } },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const space = await resolveSpace(t, actor, req.params.id);
        if (!can(actor, 'board.manage', spaceCtx(space))) throw forbidden();
        assertWritable(space);
        const board = await t.boards.findOne({ spaceId: space.id });
        if (!board) throw notFound('Board');
        if (board.type !== 'service') {
          throw new AppError(409, 'not_service_desk', 'Only a service desk has response targets');
        }
        if (!isSlaPolicy(req.body)) throw new AppError(422, 'validation_error', 'Those targets are not valid');
        await t.boards.updateOne({ id: board.id }, { settings: { ...board.settings, sla: req.body }, updatedAt: new Date() });
        liveTouch({ orgId: t.orgId, spaceId: space.id, kind: 'updated', itemId: null });
        return { policy: req.body };
      });
    },
  );

  // ---- Checklist templates ---------------------------------------------------------------------------------

  r.get('/spaces/:id/checklist-templates', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      const space = await resolveSpace(t, actor, req.params.id);
      const rows = await t.checklistTemplates.find({ spaceId: space.id }, { sort: { nameLower: 1 } });
      return {
        items: rows.map((x) => ({ id: x.id, name: x.name, items: x.items })),
        permissions: { manage: can(actor, 'status.manage', spaceCtx(space)) && space.status === 'active' },
      };
    });
  });

  r.post(
    '/spaces/:id/checklist-templates',
    { preHandler: requireAuth, schema: { params: idParam, body: templateBody } },
    async (req) => {
      const actor = actorOf(req);
      return withTenantTx(deps.db, actor.orgId, async (t) => {
        const space = await resolveSpace(t, actor, req.params.id);
        if (!can(actor, 'status.manage', spaceCtx(space))) throw forbidden();
        assertWritable(space);
        if ((await t.checklistTemplates.count({ spaceId: space.id })) >= MAX_TEMPLATES) {
          throw new AppError(409, 'too_many', `A space can have up to ${MAX_TEMPLATES} checklist templates`);
        }
        const nameLower = req.body.name.toLowerCase();
        if (await t.checklistTemplates.findOne({ spaceId: space.id, nameLower })) {
          throw new AppError(409, 'name_taken', 'A checklist with that name already exists', { name: 'That name is taken' });
        }
        const row = await t.checklistTemplates.insert({
          spaceId: space.id,
          name: req.body.name,
          nameLower,
          items: req.body.items,
          createdAt: new Date(),
        });
        return { id: row.id, name: row.name, items: row.items };
      });
    },
  );

  r.delete('/checklist-templates/:id', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenantTx(deps.db, actor.orgId, async (t) => {
      const row = await t.checklistTemplates.get(req.params.id);
      if (!row) throw notFound('Checklist');
      const space = await resolveSpace(t, actor, row.spaceId).catch(() => {
        throw notFound('Checklist');
      });
      if (!can(actor, 'status.manage', spaceCtx(space))) throw forbidden();
      assertWritable(space);
      await t.checklistTemplates.deleteOne({ id: row.id });
      return { ok: true };
    });
  });
}
