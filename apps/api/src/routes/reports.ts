import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { withTenant } from '../db/client.js';
import { assertFeature, hasFeature, loadPlan } from '../plans/index.js';
import { endOfDay, createdVsResolved, cumulativeFlow, cycleTimes, lastDays, trackItems } from '../work/flow.js';
import { resolveSpace } from './spaces.js';

const idParam = z.object({ id: z.string().min(1).max(64) });

/** Flow reports for a space: velocity, cumulative flow, cycle time, created against resolved. */
export async function reportRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/spaces/:id/reports',
    {
      preHandler: requireAuth,
      schema: { params: idParam, querystring: z.object({ days: z.coerce.number().int().min(7).max(90).default(30) }) },
    },
    async (req) => {
      const actor = actorOf(req);
      const { days } = req.query;
      return withTenant(deps.db, actor.orgId, async (t) => {
        const space = await resolveSpace(t, actor, req.params.id);
        assertFeature(await loadPlan(t, actor.orgId), 'advanced_reports', 'Flow reports');
        const settings = await t.tenantSettings.findOne({});
        const tz = settings?.timezone ?? 'UTC';
        const dates = lastDays(new Date(), tz, days);
        const items = await trackItems(t, space.id, space.key);
        const from = endOfDay(dates[0]!, tz) - 86_400_000;
        const to = endOfDay(dates[dates.length - 1]!, tz);

        const board = await t.boards.findOne({ spaceId: space.id });
        let velocity: { name: string; committed: number; completed: number; endDate: string | null }[] | null = null;
        if (board?.type === 'scrum') {
          const closed = await t.sprints.find({ spaceId: space.id, state: 'closed' }, { sort: { closedAt: -1 }, limit: 6 });
          velocity = closed
            .reverse()
            .map((s) => ({
              name: s.name,
              committed: s.startPoints ?? 0,
              completed: s.summary?.completedPoints ?? 0,
              endDate: s.endDate,
            }));
        }
        return {
          days,
          timezone: tz,
          velocity,
          flow: cumulativeFlow(items, dates, tz),
          throughput: createdVsResolved(items, dates, tz),
          cycle: cycleTimes(items, from, to),
        };
      });
    },
  );

  /** Whether the plan includes the reports, so the tab can show an upgrade note without a 402. */
  r.get('/spaces/:id/reports/access', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (t) => {
      await resolveSpace(t, actor, req.params.id);
      return { enabled: hasFeature(await loadPlan(t, actor.orgId), 'advanced_reports') };
    });
  });
}
