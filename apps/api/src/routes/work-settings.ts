import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { writeAudit } from '../audit/service.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { loadSettings } from '../checkin/service.js';
import { withTenant } from '../db/client.js';
import { holidays, sites, tenantSettings, workDays } from '../db/schema.js';
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

export async function workSettingsRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ---- Work settings ----------------------------------------------------------------------
  r.get('/settings/work', { preHandler: requireAuth }, async (req) => {
    const actor = actorOf(req);
    return withTenant(deps.db, actor.orgId, async (tx) => ({
      settings: await loadSettings(tx, actor.orgId),
      sites: await tx
        .select({ id: sites.id, name: sites.name, address: sites.address })
        .from(sites)
        .where(eq(sites.orgId, actor.orgId))
        .orderBy(asc(sql`lower(${sites.name})`)),
    }));
  });

  r.put(
    '/settings/work',
    { preHandler: requireAuth, schema: { body: settingsBody } },
    async (req) => {
      const actor = actorOf(req);
      if (!can(actor, 'settings.manage')) throw forbidden();
      const b = req.body;
      return withTenant(deps.db, actor.orgId, async (tx) => {
        const before = await loadSettings(tx, actor.orgId);
        // Keep the other modules as they are; this form only controls check-in.
        const modules = [
          'members',
          'spaces',
          ...(b.checkinEnabled ? ['checkin'] : []),
          ...(before.crmEnabled ? ['crm'] : []),
        ];
        const values = {
          timezone: b.timezone,
          workDays: b.workDays,
          workStart: b.workStart,
          workEnd: b.workEnd,
          autoCloseTime: b.autoCloseTime,
          requireNote: b.requireNote,
          enabledModules: modules,
          updatedAt: new Date(),
        };
        await tx
          .insert(tenantSettings)
          .values({ orgId: actor.orgId, ...values })
          .onConflictDoUpdate({ target: tenantSettings.orgId, set: values });
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
      items: await tx
        .select({ id: sites.id, name: sites.name, address: sites.address })
        .from(sites)
        .where(eq(sites.orgId, actor.orgId))
        .orderBy(asc(sql`lower(${sites.name})`)),
    }));
  });

  r.post('/sites', { preHandler: requireAuth, schema: { body: siteBody } }, async (req) => {
    const actor = actorOf(req);
    if (!can(actor, 'settings.manage')) throw forbidden();
    try {
      return await withTenant(deps.db, actor.orgId, async (tx) => {
        const [row] = await tx
          .insert(sites)
          .values({ orgId: actor.orgId, name: req.body.name, address: req.body.address || null })
          .returning({ id: sites.id, name: sites.name, address: sites.address });
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'site.created',
          targetType: 'site',
          targetId: row!.id,
          after: { name: row!.name },
        });
        return row!;
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
        return await withTenant(deps.db, actor.orgId, async (tx) => {
          const [before] = await tx
            .select()
            .from(sites)
            .where(and(eq(sites.id, req.params.id), eq(sites.orgId, actor.orgId)));
          if (!before) throw notFound('Site');
          const patch = {
            ...(req.body.name !== undefined ? { name: req.body.name } : {}),
            ...(req.body.address !== undefined ? { address: req.body.address || null } : {}),
          };
          if (Object.keys(patch).length === 0)
            throw new AppError(400, 'validation_error', 'Nothing to update');
          const [row] = await tx
            .update(sites)
            .set(patch)
            .where(and(eq(sites.id, before.id), eq(sites.orgId, actor.orgId)))
            .returning({ id: sites.id, name: sites.name, address: sites.address });
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'site.updated',
            targetType: 'site',
            targetId: before.id,
            before: { name: before.name, address: before.address },
            after: patch,
          });
          return row!;
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
    await withTenant(deps.db, actor.orgId, async (tx) => {
      const [site] = await tx
        .select()
        .from(sites)
        .where(and(eq(sites.id, req.params.id), eq(sites.orgId, actor.orgId)));
      if (!site) throw notFound('Site');
      const used = await tx
        .select({ id: workDays.id })
        .from(workDays)
        .where(and(eq(workDays.siteId, site.id), eq(workDays.orgId, actor.orgId)))
        .limit(1);
      if (used.length) {
        throw new AppError(
          409,
          'site_in_use',
          'People have checked in at this site, so it cannot be deleted',
        );
      }
      await tx.delete(sites).where(and(eq(sites.id, site.id), eq(sites.orgId, actor.orgId)));
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
        items: await tx
          .select({ id: holidays.id, date: holidays.date, name: holidays.name })
          .from(holidays)
          .where(
            and(
              eq(holidays.orgId, actor.orgId),
              year ? gte(holidays.date, `${year}-01-01`) : undefined,
              year ? lt(holidays.date, `${year + 1}-01-01`) : undefined,
            ),
          )
          .orderBy(asc(holidays.date)),
      }));
    },
  );

  r.post('/holidays', { preHandler: requireAuth, schema: { body: holidayBody } }, async (req) => {
    const actor = actorOf(req);
    if (!can(actor, 'settings.manage')) throw forbidden();
    try {
      return await withTenant(deps.db, actor.orgId, async (tx) => {
        const [row] = await tx
          .insert(holidays)
          .values({ orgId: actor.orgId, date: req.body.date, name: req.body.name })
          .returning({ id: holidays.id, date: holidays.date, name: holidays.name });
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'holiday.created',
          targetType: 'holiday',
          targetId: row!.id,
          after: { date: row!.date, name: row!.name },
        });
        return row!;
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
        return await withTenant(deps.db, actor.orgId, async (tx) => {
          const [before] = await tx
            .select()
            .from(holidays)
            .where(and(eq(holidays.id, req.params.id), eq(holidays.orgId, actor.orgId)));
          if (!before) throw notFound('Holiday');
          if (Object.keys(req.body).length === 0)
            throw new AppError(400, 'validation_error', 'Nothing to update');
          const [row] = await tx
            .update(holidays)
            .set(req.body)
            .where(and(eq(holidays.id, before.id), eq(holidays.orgId, actor.orgId)))
            .returning({ id: holidays.id, date: holidays.date, name: holidays.name });
          await writeAudit(tx, {
            orgId: actor.orgId,
            actorId: actor.userId,
            action: 'holiday.updated',
            targetType: 'holiday',
            targetId: before.id,
            before: { date: before.date, name: before.name },
            after: req.body,
          });
          return row!;
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
      await withTenant(deps.db, actor.orgId, async (tx) => {
        const [row] = await tx
          .select()
          .from(holidays)
          .where(and(eq(holidays.id, req.params.id), eq(holidays.orgId, actor.orgId)));
        if (!row) throw notFound('Holiday');
        await tx
          .delete(holidays)
          .where(and(eq(holidays.id, row.id), eq(holidays.orgId, actor.orgId)));
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
