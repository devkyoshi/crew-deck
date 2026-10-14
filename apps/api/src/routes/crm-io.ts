import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { writeAudit } from '../audit/service.js';
import { actorOf } from '../auth/actor.js';
import { makeRequireAuth, type AuthDeps } from '../auth/plugin.js';
import { BOM, crmGuard, csvCell } from '../crm/helpers.js';
import { withTenant } from '../db/client.js';
import { crmCompanies, crmContacts, crmLeads, memberships, users } from '../db/schema.js';
import { AppError } from '../lib/errors.js';

export const MAX_IMPORT_ROWS = 5000;
const types = z.enum(['companies', 'contacts', 'leads']);
type ImportType = z.infer<typeof types>;

/** Importable columns per record type. `required` fields must be mapped and filled in on every row. */
export const IMPORT_FIELDS: Record<
  ImportType,
  { key: string; label: string; required?: boolean }[]
> = {
  companies: [
    { key: 'name', label: 'Name', required: true },
    { key: 'website', label: 'Website' },
    { key: 'industry', label: 'Industry' },
    { key: 'size', label: 'Size' },
    { key: 'owner', label: 'Owner (email)' },
  ],
  contacts: [
    { key: 'name', label: 'Name', required: true },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'jobTitle', label: 'Job title' },
    { key: 'company', label: 'Company (name)' },
    { key: 'owner', label: 'Owner (email)' },
  ],
  leads: [
    { key: 'name', label: 'Name', required: true },
    { key: 'email', label: 'Email' },
    { key: 'companyName', label: 'Company name' },
    { key: 'source', label: 'Source' },
    { key: 'status', label: 'Status (new, contacted, qualified, unqualified)' },
    { key: 'owner', label: 'Owner (email)' },
  ],
};

/** A small RFC 4180 reader: quoted fields, doubled quotes, newlines inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const emailOk = z.string().email();
const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'unqualified'];

export async function crmIoRoutes(app: FastifyInstance, deps: AuthDeps) {
  const requireAuth = makeRequireAuth(deps);
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/crm/import/:type/fields',
    { preHandler: requireAuth, schema: { params: z.object({ type: types }) } },
    async (req) => {
      const actor = actorOf(req);
      await withTenant(deps.db, actor.orgId, (tx) => crmGuard(tx, actor, 'admin'));
      return { fields: IMPORT_FIELDS[req.params.type], maxRows: MAX_IMPORT_ROWS };
    },
  );

  // Import from CSV text. `mapping` maps a field key to the CSV column header. With dryRun the rows are
  // checked and nothing is written. Without it, any invalid row rejects the whole file.
  r.post(
    '/crm/import/:type',
    {
      preHandler: requireAuth,
      bodyLimit: 3 * 1024 * 1024,
      schema: {
        params: z.object({ type: types }),
        body: z.object({
          csv: z.string().min(1).max(3_000_000),
          mapping: z.record(z.string(), z.string()),
          dryRun: z.boolean().default(false),
        }),
      },
    },
    async (req, reply) => {
      const actor = actorOf(req);
      const type = req.params.type;
      const table = parseCsv(req.body.csv);
      if (table.length < 2) {
        throw new AppError(400, 'validation_error', 'The file has no data rows', {
          csv: 'Add at least one row under the header',
        });
      }
      const header = table[0]!.map((h) => h.trim());
      const dataRows = table.slice(1);
      if (dataRows.length > MAX_IMPORT_ROWS) {
        throw new AppError(
          400,
          'validation_error',
          `Imports are limited to ${MAX_IMPORT_ROWS} rows`,
          { csv: `Split the file into batches of ${MAX_IMPORT_ROWS} rows or fewer` },
        );
      }
      const fields = IMPORT_FIELDS[type];
      const idx: Record<string, number> = {};
      for (const f of fields) {
        const col = req.body.mapping[f.key];
        if (col === undefined || col === '') {
          if (f.required)
            throw new AppError(400, 'validation_error', `Map a column to ${f.label}`, {
              mapping: `Map a column to ${f.label}`,
            });
          continue;
        }
        const at = header.indexOf(col);
        if (at === -1)
          throw new AppError(400, 'validation_error', `Column “${col}” is not in the file`, {
            mapping: `Column “${col}” is not in the file`,
          });
        idx[f.key] = at;
      }
      const cellOf = (row: string[], key: string) => {
        const at = idx[key];
        const v = at === undefined ? '' : (row[at] ?? '').trim();
        return v === '' ? null : v;
      };

      type Failure = { row: number; field: string; message: string };

      const result = await withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');

        // Owners by email (active members only).
        const owners = await tx
          .select({ id: users.id, email: users.email })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.orgId, actor.orgId), eq(memberships.status, 'active')));
        const ownerByEmail = new Map(owners.map((o) => [o.email.toLowerCase(), o.id]));

        const existingCompanies = await tx
          .select({ id: crmCompanies.id, name: crmCompanies.name })
          .from(crmCompanies)
          .where(and(eq(crmCompanies.orgId, actor.orgId), isNull(crmCompanies.deletedAt)));
        const companyByName = new Map(existingCompanies.map((c) => [c.name.toLowerCase(), c.id]));

        const failures: Failure[] = [];
        const fail = (row: number, field: string, message: string) =>
          failures.push({ row, field, message });
        const seenNames = new Set<string>();
        const clean: Record<string, string | null>[] = [];

        dataRows.forEach((raw, i) => {
          const rowNo = i + 2; // spreadsheet row numbers: the header is row 1
          const v: Record<string, string | null> = {};
          for (const f of fields) v[f.key] = cellOf(raw, f.key);
          if (!v.name) fail(rowNo, 'name', 'Name is required');
          else if (v.name.length > 120) fail(rowNo, 'name', 'Name is longer than 120 characters');
          if (v.email && !emailOk.safeParse(v.email).success)
            fail(rowNo, 'email', 'Not a valid email address');
          if (v.owner) {
            const id = ownerByEmail.get(v.owner.toLowerCase());
            if (!id) fail(rowNo, 'owner', 'No active member has that email');
            else v.ownerId = id;
          }
          if (type === 'companies' && v.name) {
            const key = v.name.toLowerCase();
            if (companyByName.has(key))
              fail(rowNo, 'name', 'A company with that name already exists');
            else if (seenNames.has(key)) fail(rowNo, 'name', 'This name appears twice in the file');
            seenNames.add(key);
          }
          if (type === 'contacts' && v.company) {
            const id = companyByName.get(v.company.toLowerCase());
            if (!id) fail(rowNo, 'company', 'No company with that name. Import companies first.');
            else v.companyId = id;
          }
          if (type === 'leads' && v.status) {
            v.status = v.status.toLowerCase();
            if (!LEAD_STATUSES.includes(v.status))
              fail(rowNo, 'status', 'Use new, contacted, qualified or unqualified');
          }
          clean.push(v);
        });

        const summary = {
          total: dataRows.length,
          validRows: dataRows.length - new Set(failures.map((f) => f.row)).size,
          errors: failures.slice(0, 200),
          errorCount: failures.length,
          preview: clean
            .slice(0, 10)
            .map((c) => ({ ...c, ownerId: undefined, companyId: undefined })),
        };
        if (failures.length || req.body.dryRun) return { ...summary, created: 0, applied: false };

        const owner = (v: Record<string, string | null>) => v.ownerId ?? actor.userId;
        const batch = <T>(items: T[], size = 500) =>
          Array.from({ length: Math.ceil(items.length / size) }, (_, k) =>
            items.slice(k * size, (k + 1) * size),
          );
        if (type === 'companies') {
          for (const part of batch(clean)) {
            await tx.insert(crmCompanies).values(
              part.map((v) => ({
                orgId: actor.orgId,
                name: v.name!,
                website: v.website,
                industry: v.industry,
                size: v.size,
                ownerId: owner(v),
                createdBy: actor.userId,
              })),
            );
          }
        } else if (type === 'contacts') {
          for (const part of batch(clean)) {
            await tx.insert(crmContacts).values(
              part.map((v) => ({
                orgId: actor.orgId,
                name: v.name!,
                email: v.email?.toLowerCase() ?? null,
                phone: v.phone,
                jobTitle: v.jobTitle,
                companyId: v.companyId ?? null,
                ownerId: owner(v),
                createdBy: actor.userId,
              })),
            );
          }
        } else {
          for (const part of batch(clean)) {
            await tx.insert(crmLeads).values(
              part.map((v) => ({
                orgId: actor.orgId,
                name: v.name!,
                email: v.email?.toLowerCase() ?? null,
                companyName: v.companyName,
                source: v.source,
                status: (v.status ?? 'new') as 'new',
                ownerId: owner(v),
                createdBy: actor.userId,
              })),
            );
          }
        }
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.import',
          targetType: 'crm_import',
          targetId: actor.orgId,
          after: { type, rows: clean.length },
        });
        return { ...summary, created: clean.length, applied: true };
      });

      // A file with invalid rows is rejected as a whole, but the response still lists every problem.
      if (!req.body.dryRun && result.errorCount > 0) reply.code(422);
      return result;
    },
  );

  // ---- Export ---------------------------------------------------------------------------------
  r.get(
    '/crm/export/:type',
    { preHandler: requireAuth, schema: { params: z.object({ type: types }) } },
    async (req, reply) => {
      const actor = actorOf(req);
      const type = req.params.type;
      const csv = await withTenant(deps.db, actor.orgId, async (tx) => {
        await crmGuard(tx, actor, 'admin');
        const owner = sql<string | null>`coalesce(${users.name}, ${users.email})`;
        let header: string[];
        let rows: unknown[][];
        if (type === 'companies') {
          header = ['Name', 'Website', 'Industry', 'Size', 'Owner', 'Created'];
          const data = await tx
            .select({
              name: crmCompanies.name,
              website: crmCompanies.website,
              industry: crmCompanies.industry,
              size: crmCompanies.size,
              owner,
              createdAt: crmCompanies.createdAt,
            })
            .from(crmCompanies)
            .leftJoin(users, eq(users.id, crmCompanies.ownerId))
            .where(and(eq(crmCompanies.orgId, actor.orgId), isNull(crmCompanies.deletedAt)))
            .orderBy(asc(sql`lower(${crmCompanies.name})`), asc(crmCompanies.id));
          rows = data.map((d) => [
            d.name,
            d.website,
            d.industry,
            d.size,
            d.owner,
            d.createdAt.toISOString(),
          ]);
        } else if (type === 'contacts') {
          header = ['Name', 'Email', 'Phone', 'Job title', 'Company', 'Owner', 'Created'];
          const data = await tx
            .select({
              name: crmContacts.name,
              email: crmContacts.email,
              phone: crmContacts.phone,
              jobTitle: crmContacts.jobTitle,
              company: crmCompanies.name,
              owner,
              createdAt: crmContacts.createdAt,
            })
            .from(crmContacts)
            .leftJoin(
              crmCompanies,
              and(
                eq(crmCompanies.id, crmContacts.companyId),
                eq(crmCompanies.orgId, crmContacts.orgId),
              ),
            )
            .leftJoin(users, eq(users.id, crmContacts.ownerId))
            .where(and(eq(crmContacts.orgId, actor.orgId), isNull(crmContacts.deletedAt)))
            .orderBy(asc(sql`lower(${crmContacts.name})`), asc(crmContacts.id));
          rows = data.map((d) => [
            d.name,
            d.email,
            d.phone,
            d.jobTitle,
            d.company,
            d.owner,
            d.createdAt.toISOString(),
          ]);
        } else {
          header = [
            'Name',
            'Email',
            'Company',
            'Source',
            'Status',
            'Owner',
            'Converted',
            'Created',
          ];
          const data = await tx
            .select({
              name: crmLeads.name,
              email: crmLeads.email,
              companyName: crmLeads.companyName,
              source: crmLeads.source,
              status: crmLeads.status,
              owner,
              convertedAt: crmLeads.convertedAt,
              createdAt: crmLeads.createdAt,
            })
            .from(crmLeads)
            .leftJoin(users, eq(users.id, crmLeads.ownerId))
            .where(and(eq(crmLeads.orgId, actor.orgId), isNull(crmLeads.deletedAt)))
            .orderBy(asc(sql`lower(${crmLeads.name})`), asc(crmLeads.id));
          rows = data.map((d) => [
            d.name,
            d.email,
            d.companyName,
            d.source,
            d.status,
            d.owner,
            d.convertedAt?.toISOString() ?? '',
            d.createdAt.toISOString(),
          ]);
        }
        await writeAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'crm.export',
          targetType: 'crm_import',
          targetId: actor.orgId,
          after: { type, rows: rows.length },
        });
        return (
          BOM + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
        );
      });
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="crm-${type}.csv"`);
      return csv;
    },
  );
}
