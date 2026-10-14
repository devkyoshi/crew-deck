const fs = require('fs');
const edit = (file, fn) => {
  const p = 'src/' + file;
  const before = fs.readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error('no change in ' + file);
  fs.writeFileSync(p, after);
};
const rep = (s, a, b) => {
  if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70));
  return s.replace(a, b);
};
const afterRoute = (s, route, anchor, insertion) => {
  const i = s.indexOf(route);
  if (i < 0) throw new Error('route missing: ' + route);
  const j = s.indexOf(anchor, i);
  if (j < 0) throw new Error('anchor missing after: ' + route);
  return s.slice(0, j + anchor.length) + insertion + s.slice(j + anchor.length);
};

// ---- Org type
edit('auth/service.ts', (s) => {
  s = rep(
    s,
    'export type Org = {\n  id: string;\n  name: string;\n  slug: string;\n  domain: string;\n};',
    "export type Org = {\n  id: string;\n  name: string;\n  slug: string;\n  domain: string;\n  status: 'active' | 'suspended';\n  suspended_reason: string | null;\n  logo_url: string | null;\n  accent_color: string | null;\n  domain_restricted: boolean;\n};",
  );
  s = rep(
    s,
    "  if (!emailMatchesOrg(invitation.email, org)) {\n    throw new AppError(403, 'domain_not_allowed', 'This email is not on the workspace domain');\n  }\n",
    '',
  );
  s = rep(
    s,
    '  return withTenant(db, org.id, async (tx) => {\n    // Atomic claim',
    "  return withTenant(db, org.id, async (tx) => {\n    // Free workspaces accept anyone; paid ones can lock invitations to the company domain.\n    const plan = await loadPlan(tx, org.id);\n    if (\n      org.domain_restricted &&\n      hasFeature(plan, 'domain_lock') &&\n      !emailMatchesOrg(invitation.email, org)\n    ) {\n      throw new AppError(403, 'domain_not_allowed', 'This email is not on the workspace domain');\n    }\n    // Atomic claim",
  );
  s = rep(s, "import { hashPassword } from './password.js';", "import { hasFeature, loadPlan } from '../plans/index.js';\nimport { hashPassword } from './password.js';");
  return s;
});

edit('auth/routes.ts', (s) => {
  s = rep(s, "if (!emailMatchesOrg(profile.email, org)) return fail('domain_not_allowed');", "if (org.domain_restricted && !emailMatchesOrg(profile.email, org)) return fail('domain_not_allowed');");
  s = rep(s, 'domainHint: org.domain }', 'domainHint: org.domain_restricted ? org.domain : undefined }');
  return s;
});

// ---- Suspension at the tenant gate
edit('auth/plugin.ts', (s) =>
  rep(
    s,
    "    if (!org) throw new AppError(404, 'tenant_not_found', 'Workspace not found');\n    req.org = org;",
    "    if (!org) throw new AppError(404, 'tenant_not_found', 'Workspace not found');\n    // A suspended workspace cannot be used at all: no sign-in, and live sessions stop here.\n    if (org.status === 'suspended') {\n      throw new AppError(403, 'workspace_suspended', 'This workspace is suspended. Contact your administrator or support.');\n    }\n    req.org = org;",
  ),
);

// ---- Invitations: seats and domain lock
edit('routes/invitations.ts', (s) => {
  s = rep(s, '        const out: InviteResult[] = [];\n', "        const out: InviteResult[] = [];\n        const plan = await loadPlan(tx, actor.orgId);\n        const restricted = org.domain_restricted && hasFeature(plan, 'domain_lock');\n        let seatsUsed = await countSeats(tx, actor.orgId);\n");
  s = rep(s, 'if (!emailMatchesOrg(addr, org)) {', 'if (restricted && !emailMatchesOrg(addr, org)) {');
  s = rep(s, '          const token = randomToken();\n', "          assertWithinLimit(plan, 'seats', seatsUsed);\n          seatsUsed++;\n          const token = randomToken();\n");
  const lastImport = s.lastIndexOf("import ");
  const eol = s.indexOf('\n', s.indexOf(';', lastImport));
  s = s.slice(0, eol + 1) + "import { assertWithinLimit, countSeats, hasFeature, loadPlan } from '../plans/index.js';\n" + s.slice(eol + 1);
  return s;
});

// ---- Spaces
edit('routes/spaces.ts', (s) => {
  s = rep(s, '        // Keys are unique per workspace and never reused, deleted spaces included.', "        assertWithinLimit(await loadPlan(tx, actor.orgId), 'spaces', await countSpaces(tx, actor.orgId));\n        // Keys are unique per workspace and never reused, deleted spaces included.");
  s = rep(s, "import { writeAudit } from '../audit/service.js';", "import { writeAudit } from '../audit/service.js';\nimport { assertWithinLimit, countSpaces, loadPlan } from '../plans/index.js';");
  return s;
});

// ---- Space audit log
edit('routes/space-members.ts', (s) => {
  s = rep(s, "        if (!can(actor, 'audit.viewSpace', spaceCtx(space))) throw forbidden();\n        return listAudit(", "        if (!can(actor, 'audit.viewSpace', spaceCtx(space))) throw forbidden();\n        const plan = await loadPlan(tx, actor.orgId);\n        assertFeature(plan, 'space_audit', 'The per-space audit log');\n        return listAudit(");
  s = rep(s, "import { listAudit, writeAudit } from '../audit/service.js';", "import { listAudit, writeAudit } from '../audit/service.js';\nimport { assertFeature, loadPlan } from '../plans/index.js';");
  return s;
});

// ---- Org audit log: history window
edit('routes/audit.ts', (s) => {
  s = rep(s, "      return withTenant(deps.db, actor.orgId, (tx) => listAudit(tx, { ...q, orgId: actor.orgId }));", "      return withTenant(deps.db, actor.orgId, async (tx) => {\n        // The plan decides how far back the log can be read; older entries are kept, not shown.\n        const floor = auditFloor(await loadPlan(tx, actor.orgId));\n        const from = floor && (!q.from || q.from < floor) ? floor : q.from;\n        return listAudit(tx, { ...q, from, orgId: actor.orgId });\n      });");
  s = rep(s, "import { AUDIT_TARGET_TYPES, listAudit } from '../audit/service.js';", "import { AUDIT_TARGET_TYPES, listAudit } from '../audit/service.js';\nimport { auditFloor, loadPlan } from '../plans/index.js';");
  return s;
});

// ---- Attendance export
edit('routes/checkin.ts', (s) => {
  s = rep(s, "      const csv = await withTenant(deps.db, actor.orgId, async (tx) => {\n        const out = await historyRows(tx, actor, { scope: 'all', ...req.query });", "      const csv = await withTenant(deps.db, actor.orgId, async (tx) => {\n        assertFeature(await loadPlan(tx, actor.orgId), 'attendance_export', 'Attendance export');\n        const out = await historyRows(tx, actor, { scope: 'all', ...req.query });");
  s = rep(s, "import { writeAudit } from '../audit/service.js';", "import { writeAudit } from '../audit/service.js';\nimport { assertFeature, loadPlan } from '../plans/index.js';");
  return s;
});

// ---- Sites
edit('routes/work-settings.ts', (s) => {
  s = rep(s, "      return await withTenant(deps.db, actor.orgId, async (tx) => {\n        const [row] = await tx\n          .insert(sites)", "      return await withTenant(deps.db, actor.orgId, async (tx) => {\n        assertWithinLimit(await loadPlan(tx, actor.orgId), 'sites', await countSites(tx, actor.orgId));\n        const [row] = await tx\n          .insert(sites)");
  s = rep(s, "import { writeAudit } from '../audit/service.js';", "import { writeAudit } from '../audit/service.js';\nimport { assertWithinLimit, countSites, loadPlan } from '../plans/index.js';");
  return s;
});

// ---- CRM
edit('crm/helpers.ts', (s) => {
  s = rep(s, "import { AppError, forbidden } from '../lib/errors.js';", "import { AppError, forbidden } from '../lib/errors.js';\nimport { assertWithinLimit, countCrmRecords, loadPlan } from '../plans/index.js';");
  s += "\n/** Creating `adding` more CRM records must fit the plan's record limit. */\nexport async function crmCapacity(tx: Tx, orgId: string, adding = 1) {\n  if (adding <= 0) return;\n  assertWithinLimit(await loadPlan(tx, orgId), 'crm_records', await countCrmRecords(tx, orgId), adding);\n}\n";
  return s;
});

edit('routes/crm-records.ts', (s) => {
  for (const route of ["r.post('/crm/companies'", "r.post('/crm/contacts'", "r.post('/crm/leads'"]) {
    s = afterRoute(s, route, "await crmGuard(tx, actor, 'edit');", '\n        await crmCapacity(tx, actor.orgId);');
  }
  s = afterRoute(
    s,
    "'/crm/leads/:id/convert'",
    'const b = req.body;',
    "\n          await crmCapacity(\n            tx,\n            actor.orgId,\n            (b.company.mode === 'new' ? 1 : 0) + (b.contact.mode === 'new' ? 1 : 0) + (b.deal ? 1 : 0),\n          );",
  );
  s = rep(s, '  crmGuard,\n', '  crmCapacity,\n  crmGuard,\n');
  return s;
});

edit('routes/crm-deals.ts', (s) => {
  s = afterRoute(s, "r.post('/crm/deals'", "await crmGuard(tx, actor, 'edit');", '\n      await crmCapacity(tx, actor.orgId);');
  s = afterRoute(
    s,
    "'/crm/pipelines',\n    { preHandler: requireAuth, schema: { body: z.object({ name",
    'await ensureDefaultPipeline(tx, actor.orgId);',
    "\n        assertWithinLimit(await loadPlan(tx, actor.orgId), 'pipelines', await countPipelines(tx, actor.orgId));",
  );
  s = rep(s, '  crmGuard,\n', '  crmCapacity,\n  crmGuard,\n');
  s = rep(s, "import { AppError, notFound } from '../lib/errors.js';", "import { AppError, notFound } from '../lib/errors.js';\nimport { assertWithinLimit, countPipelines, loadPlan } from '../plans/index.js';");
  return s;
});

edit('routes/crm-io.ts', (s) => {
  s = rep(s, "        await crmGuard(tx, actor, 'admin');\n\n        // Owners by email", "        await crmGuard(tx, actor, 'admin');\n        assertFeature(await loadPlan(tx, actor.orgId), 'crm_io', 'CSV import');\n\n        // Owners by email");
  s = rep(s, "        const owner = (v: Record<string, string | null>) => v.ownerId ?? actor.userId;", "        await crmCapacity(tx, actor.orgId, clean.length);\n        const owner = (v: Record<string, string | null>) => v.ownerId ?? actor.userId;");
  s = rep(s, "      await crmGuard(tx, actor, 'admin');\n      const owner = sql", "      await crmGuard(tx, actor, 'admin');\n      assertFeature(await loadPlan(tx, actor.orgId), 'crm_io', 'CSV export');\n      const owner = sql");
  s = rep(s, "import { BOM, crmGuard, csvCell } from '../crm/helpers.js';", "import { BOM, crmCapacity, crmGuard, csvCell } from '../crm/helpers.js';\nimport { assertFeature, loadPlan } from '../plans/index.js';");
  return s;
});
console.log('patched');
