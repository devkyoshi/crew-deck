import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { writeAudit } from '../audit/service.js';
import { assertWithinLimit, countSites, loadPlan } from '../plans/index.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { loadSettings } from '../checkin/service.js';
import { withTenant, withTenantTx } from '../db/client.js';
import { AppError, forbidden, isUniqueViolation, notFound } from '../lib/errors.js';
import { isRealDate, isValidTimezone } from '../lib/time.js';
import { can } from '../permissions/can.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, 24-hour');
const isoDate = z.string().refine(isRealDate, 'Use a real date as YYYY-MM-DD');
const idParam = z.object({ id: z.string().uuid() });
const name = z.string().trim().min(1, 'Enter a name').max(80);

const settingsBody = z
  .object({
    timezone: z.string().refine(isValidTimezone, 'Unknown timezone, for example Europe/London'),
    workDays: z
      .array(z.number().int().min(1).max(7))
      .min(1, 'Choose at least one working day')
      .transform((d) => [...new Set(d)].sort((a, b) => a - b)),
    workStart: hhmm,
    workEnd: hhmm,
    autoCloseTime: hhmm,
    requireNote: z.boolean(),
    checkinEnabled: z.boolean(),
  })
  .refine((v) => v.workStart < v.workEnd, {
    path: ['workEnd'],
    message: 'Must be after the start time',
  });

const siteShape = (s: { id: string; name: string; address: string | null }) => ({
  id: s.id,
  name: s.name,
  address: s.address,
});

export async function workSettingsRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ---- Work settings ----------------------------------------------------------------------
  r.get('/settings/work', { preHandler: requireAuth }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (tx) => ({
      settings: await loadSettings(tx, actor.orgId),
      sites: (await tx.sites.find({}, { sort: { nameLower: 1 } })).map(siteShape),
    }));
  });

  r.put(
    '/settings/work',
    { preHandler: requireAuth, schema: { body: settingsBody } },
    async (req) => {
      const actor = actorOf(req);
      if (!can(actor, 'settings.manage')) throw forbidden();
      const b = req.body;
      return withTenantTx(deps.db, actor.orgId, async (tx) => {
        const before = await loadSettings(tx, actor.orgId);
        // Keep the other modules as they are; this form only controls check-in.
        const modules = [
          'members',
          'spaces',
          ...(b.checkinEnabled ? ['checkin'] : []),
          ...(before.crmEnabled ? ['crm'] : []),
        ];
        await tx.tenantSettings.upsert(
          {},
          {
            timezone: b.timezone,
            workDays: b.workDays,
            workStart: b.workStart,
            workEnd: b.workEnd,
            autoCloseTime: b.autoCloseTime,
            requireNote: b.requireNote,
            enabledModules: modules,
            updatedAt: new Date(),
          },
        );
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'settings.work_updated',
          targetType: 'settings',
          targetId: actor.orgId,
          before,
          after: b,
        });
        return { settings: await loadSettings(tx, actor.orgId) };
      });
    },
  );

  // ---- Sites ------------------------------------------------------------------------------
  const siteBody = z.object({ name, address: z.string().trim().max(200).optional() });
  const siteTaken = () =>
    new AppError(409, 'name_taken', 'A site with that name already exists', {
      name: 'A site with that name already exists',
    });

  r.get('/sites', { preHandler: requireAuth }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (tx) => ({
      items: (await tx.sites.find({}, { sort: { nameLower: 1 } })).map(siteShape),
    }));
  });

  r.post('/sites', { preHandler: requireAuth, schema: { body: siteBody } }, async (req) => {
    const actor = actorOf(req);
    if (!can(actor, 'settings.manage')) throw forbidden();
    try {
      return await withTenantTx(deps.db, actor.orgId, async (tx) => {
        assertWithinLimit(
          await loadPlan(tx, actor.orgId),
          'sites',
          await countSites(tx, actor.orgId),
        );
        const row = await tx.sites.insert({
          name: req.body.name,
          address: req.body.address || null,
        });
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'site.created',
          targetType: 'site',
          targetId: row.id,
          after: { name: row.name },
        });
        return siteShape(row);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw siteTaken();
      throw e;
    }
  });

  r.patch(
    '/sites/:id',
    { preHandler: requireAuth, schema: { params: idParam, body: siteBody.partial().strict() } },
    async (req) => {
      const actor = actorOf(req);
      if (!can(actor, 'settings.manage')) throw forbidden();
      try {
        return await withTenantTx(deps.db, actor.orgId, async (tx) => {
          const before = await tx.sites.get(req.params.id);
          if (!before) throw notFound('Site');
          const patch = {
            ...(req.body.name !== undefined ? { name: req.body.name } : {}),
            ...(req.body.address !== undefined ? { address: req.body.address || null } : {}),
          };
          if (Object.keys(patch).length === 0)
            throw new AppError(400, 'validation_error', 'Nothing to update');
          const row = await tx.sites.findOneAndUpdate({ id: before.id }, patch);
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'site.updated',
            targetType: 'site',
            targetId: before.id,
            before: { name: before.name, address: before.address },
            after: patch,
          });
          return siteShape(row!);
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw siteTaken();
        throw e;
      }
    },
  );

  r.delete('/sites/:id', { preHandler: requireAuth, schema: { params: idParam } }, async (req) => {
    const actor = actorOf(req);
    if (!can(actor, 'settings.manage')) throw forbidden();
    await withTenantTx(deps.db, actor.orgId, async (tx) => {
      const site = await tx.sites.get(req.params.id);
      if (!site) throw notFound('Site');
      if (await tx.workDays.exists({ siteId: site.id })) {
        throw new AppError(
          409,
          'site_in_use',
          'People have checked in at this site, so it cannot be deleted',
        );
      }
      await tx.sites.deleteOne({ id: site.id });
      await writeAudit(tx, {
        orgId: actor.orgId,
        actorId: actor.userId,
        action: 'site.deleted',
        targetType: 'site',
        targetId: site.id,
        before: { name: site.name },
      });
    });
    return { ok: true };
  });

  // ---- Holidays ---------------------------------------------------------------------------
  const holidayBody = z.object({ date: isoDate, name });
  const dateTaken = () =>
    new AppError(409, 'date_taken', 'There is already a holiday on that date', {
      date: 'There is already a holiday on that date',
    });
  const holidayShape = (h: { id: string; date: string; name: string }) => ({
    id: h.id,
    date: h.date,
    name: h.name,
  });

  r.get(
    '/holidays',
    {
      preHandler: requireAuth,
      schema: {
        querystring: z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }),
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const year = req.query.year;
      return withTenant(deps.db, actor.orgId, async (tx) => ({
        items: (
          await tx.holidays.find(
            year ? { date: { $gte: `${year}-01-01`, $lt: `${year + 1}-01-01` } } : {},
            { sort: { date: 1 } },
          )
        ).map(holidayShape),
      }));
    },
  );

  r.post('/holidays', { preHandler: requireAuth, schema: { body: holidayBody } }, async (req) => {
    const actor = actorOf(req);
    if (!can(actor, 'settings.manage')) throw forbidden();
    try {
      return await withTenantTx(deps.db, actor.orgId, async (tx) => {
        const row = await tx.holidays.insert({ date: req.body.date, name: req.body.name });
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'holiday.created',
          targetType: 'holiday',
          targetId: row.id,
          after: { date: row.date, name: row.name },
        });
        return holidayShape(row);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw dateTaken();
      throw e;
    }
  });

  r.patch(
    '/holidays/:id',
    { preHandler: requireAuth, schema: { params: idParam, body: holidayBody.partial().strict() } },
    async (req) => {
      const actor = actorOf(req);
      if (!can(actor, 'settings.manage')) throw forbidden();
      try {
        return await withTenantTx(deps.db, actor.orgId, async (tx) => {
          const before = await tx.holidays.get(req.params.id);
          if (!before) throw notFound('Holiday');
          if (Object.keys(req.body).length === 0)
            throw new AppError(400, 'validation_error', 'Nothing to update');
          const row = await tx.holidays.findOneAndUpdate({ id: before.id }, req.body);
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'holiday.updated',
            targetType: 'holiday',
            targetId: before.id,
            before: { date: before.date, name: before.name },
            after: req.body,
          });
          return holidayShape(row!);
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw dateTaken();
        throw e;
      }
    },
  );

  r.delete(
    '/holidays/:id',
    { preHandler: requireAuth, schema: { params: idParam } },
    async (req) => {
      const actor = actorOf(req);
      if (!can(actor, 'settings.manage')) throw forbidden();
      await withTenantTx(deps.db, actor.orgId, async (tx) => {
        const row = await tx.holidays.get(req.params.id);
        if (!row) throw notFound('Holiday');
        await tx.holidays.deleteOne({ id: row.id });
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'holiday.deleted',
          targetType: 'holiday',
          targetId: row.id,
          before: { date: row.date, name: row.name },
        });
      });
      return { ok: true };
    },
  );
}
