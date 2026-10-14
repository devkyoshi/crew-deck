import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminDb,
  caller,
  createOrg,
  ensureUser,
  makeApp,
  signInAs,
  uniqueEmail,
} from './helpers.js';
import { parseCsv } from '../src/routes/crm-io.js';

const t = makeApp();
const call = caller(t.app);

type W = { slug: string; orgId: string; domain: string; owner: string };
let A: W, B: W;
let adminC: string, memberC: string, viewerC: string, noneC: string, memberId: string;
let bOwner: string;

async function workspace(
  prefix: string,
): Promise<W & { ownerUser: { id: string; email: string } }> {
  const { org, slug, owner } = await createOrg(prefix);
  return {
    slug,
    orgId: org.id,
    domain: org.domain,
    owner: await signInAs(t.app, slug, owner),
    ownerUser: owner,
  };
}

async function crmUser(w: W, crmRole: 'none' | 'viewer' | 'member' | 'admin') {
  const u = await ensureUser({
    orgId: w.orgId,
    email: uniqueEmail('crm', w.domain),
    role: 'member',
  });
  const db = adminDb();
  try {
    await db.db.tenant(w.orgId).memberships.updateOne({ userId: u.id }, { crmRole });
  } finally {
    await db.close();
  }
  return { id: u.id, cookie: await signInAs(t.app, w.slug, u) };
}

const get = (url: string, cookie: string, slug = A.slug) =>
  call({ method: 'GET', url, slug, cookie });
const post = (url: string, cookie: string, payload: object = {}, slug = A.slug) =>
  call({ method: 'POST', url, slug, cookie, payload });
const patch = (url: string, cookie: string, payload: object, slug = A.slug) =>
  call({ method: 'PATCH', url, slug, cookie, payload });
const del = (url: string, cookie: string, slug = A.slug) =>
  call({ method: 'DELETE', url, slug, cookie });

beforeAll(async () => {
  A = await workspace('crma');
  B = await workspace('crmb');
  bOwner = B.owner;
  const a = await crmUser(A, 'admin');
  const m = await crmUser(A, 'member');
  const v = await crmUser(A, 'viewer');
  const n = await crmUser(A, 'none');
  adminC = a.cookie;
  memberC = m.cookie;
  memberId = m.id;
  viewerC = v.cookie;
  noneC = n.cookie;
});
afterAll(() => t.close());

const j = (res: { body: string }) => JSON.parse(res.body);

async function company(name: string, cookie = memberC, slug = A.slug) {
  const res = await post('/crm/companies', cookie, { name }, slug);
  expect(res.statusCode).toBe(200);
  return j(res);
}

describe('access and roles', () => {
  it('reports the caller’s CRM access', async () => {
    expect(j(await get('/crm/access', viewerC))).toMatchObject({
      enabled: true,
      canView: true,
      canEdit: false,
      canAdmin: false,
    });
    expect(j(await get('/crm/access', memberC))).toMatchObject({
      canView: true,
      canEdit: true,
      canAdmin: false,
    });
    expect(j(await get('/crm/access', adminC))).toMatchObject({ canAdmin: true });
    expect(j(await get('/crm/access', noneC))).toMatchObject({ canView: false, canEdit: false });
    expect(j(await get('/crm/access', A.owner))).toMatchObject({
      canView: true,
      canEdit: true,
      canAdmin: true,
    });
  });

  it('role none sees nothing, viewer reads but cannot write, member cannot delete or import', async () => {
    const co = await company('Role Test Co');
    expect((await get('/crm/companies', noneC)).statusCode).toBe(403);
    expect((await get('/crm/deals/board', noneC)).statusCode).toBe(403);
    expect((await get('/crm/dashboard', noneC)).statusCode).toBe(403);
    expect((await get('/crm/companies', viewerC)).statusCode).toBe(200);
    expect((await get(`/crm/companies/${co.id}`, viewerC)).statusCode).toBe(200);
    expect((await post('/crm/companies', viewerC, { name: 'Nope' })).statusCode).toBe(403);
    expect((await post('/crm/leads', viewerC, { name: 'Nope' })).statusCode).toBe(403);
    expect((await post('/crm/deals', viewerC, { title: 'Nope' })).statusCode).toBe(403);
    expect(
      (await post('/crm/activities', viewerC, { type: 'task', subject: 'x' })).statusCode,
    ).toBe(403);
    expect((await patch(`/crm/companies/${co.id}`, viewerC, { industry: 'x' })).statusCode).toBe(
      403,
    );
    expect((await del(`/crm/companies/${co.id}`, memberC)).statusCode).toBe(403);
    expect((await get('/crm/export/companies', memberC)).statusCode).toBe(403);
    expect(
      (await post('/crm/import/companies', memberC, { csv: 'name\nx', mapping: { name: 'name' } }))
        .statusCode,
    ).toBe(403);
    expect((await post('/crm/pipelines', memberC, { name: 'Mine' })).statusCode).toBe(403);
    expect(
      (
        await call({
          method: 'PUT',
          url: '/crm/settings',
          slug: A.slug,
          cookie: adminC,
          payload: { enabled: false },
        })
      ).statusCode,
    ).toBe(403);
    expect((await del(`/crm/companies/${co.id}`, adminC)).statusCode).toBe(200);
  });

  it('workspace admins can set a member’s CRM role and it is audited', async () => {
    const target = await crmUser(A, 'member');
    const res = await patch(`/members/${target.id}`, A.owner, { crmRole: 'viewer' });
    expect(res.statusCode).toBe(200);
    expect(j(res).crmRole).toBe('viewer');
    expect((await patch(`/members/${target.id}`, memberC, { crmRole: 'admin' })).statusCode).toBe(
      403,
    );
    const db = adminDb();
    try {
      const rows = await db.db
        .tenant(A.orgId)
        .auditLogs.find({ action: 'member.crm_role_changed' });
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await db.close();
    }
  });

  it('the module can be switched off, which hides every CRM endpoint', async () => {
    const c = await createOrg('crmoff');
    const cookie = await signInAs(t.app, c.slug, c.owner);
    expect((await get('/crm/companies', cookie, c.slug)).statusCode).toBe(200);
    const off = await call({
      method: 'PUT',
      url: '/crm/settings',
      slug: c.slug,
      cookie,
      payload: { enabled: false },
    });
    expect(off.statusCode).toBe(200);
    const res = await get('/crm/companies', cookie, c.slug);
    expect(res.statusCode).toBe(404);
    expect(j(res).code).toBe('module_disabled');
    expect(j(await get('/crm/access', cookie, c.slug)).enabled).toBe(false);
    await call({
      method: 'PUT',
      url: '/crm/settings',
      slug: c.slug,
      cookie,
      payload: { enabled: true },
    });
    expect((await get('/crm/companies', cookie, c.slug)).statusCode).toBe(200);
    const db = adminDb();
    try {
      const row = await db.db.tenant(c.org.id).tenantSettings.findOne({});
      expect(row?.enabledModules).toContain('crm');
    } finally {
      await db.close();
    }
  });
});

describe('companies, contacts and tags', () => {
  it('creates, searches, updates and soft-deletes a company', async () => {
    const co = await company('Zephyr Analytics');
    expect(co.ownerId).toBeTruthy();
    const found = j(await get('/crm/companies?q=zephyr', viewerC));
    expect(found.items.map((c: { name: string }) => c.name)).toContain('Zephyr Analytics');
    const upd = await patch(`/crm/companies/${co.id}`, memberC, { industry: 'Data' });
    expect(j(upd).industry).toBe('Data');
    expect((await del(`/crm/companies/${co.id}`, adminC)).statusCode).toBe(200);
    expect((await get(`/crm/companies/${co.id}`, adminC)).statusCode).toBe(404);
    // The name can be reused once the old record is deleted.
    expect((await post('/crm/companies', memberC, { name: 'Zephyr Analytics' })).statusCode).toBe(
      200,
    );
  });

  it('rejects a duplicate company name (case-insensitive) and bad input', async () => {
    await company('Dup Corp');
    const dup = await post('/crm/companies', memberC, { name: 'dup corp' });
    expect(dup.statusCode).toBe(409);
    expect((await post('/crm/companies', memberC, { name: '  ' })).statusCode).toBe(400);
    expect(
      (await post('/crm/contacts', memberC, { name: 'X', email: 'not-an-email' })).statusCode,
    ).toBe(400);
  });

  it('owners must be active members of the workspace', async () => {
    const other = await crmUser(B, 'member');
    const res = await post('/crm/companies', memberC, { name: 'Owner Check', ownerId: other.id });
    expect(res.statusCode).toBe(400);
    expect(j(res).fields.ownerId).toBeTruthy();
    expect(
      (await post('/crm/companies', memberC, { name: 'Owner Ok', ownerId: memberId })).statusCode,
    ).toBe(200);
  });

  it('links contacts to companies and tags records', async () => {
    const co = await company('Tagged Co');
    const tag = j(await post('/crm/tags', memberC, { name: 'VIP', color: 'pink' }));
    expect((await post('/crm/tags', memberC, { name: 'vip' })).statusCode).toBe(409);
    const contact = j(
      await post('/crm/contacts', memberC, {
        name: 'Ada Lovelace',
        email: 'ADA@Example.com',
        companyId: co.id,
        tagIds: [tag.id],
      }),
    );
    expect(contact.email).toBe('ada@example.com');
    expect(contact.companyName).toBe('Tagged Co');
    expect(contact.tags[0].name).toBe('VIP');
    const byTag = j(await get(`/crm/contacts?tagId=${tag.id}`, viewerC));
    expect(byTag.total).toBe(1);
    const detail = j(await get(`/crm/companies/${co.id}`, viewerC));
    expect(detail.contacts).toHaveLength(1);
    // An unknown tag is rejected.
    const bad = await patch(`/crm/contacts/${contact.id}`, memberC, {
      tagIds: ['00000000-0000-4000-8000-000000000000'],
    });
    expect(bad.statusCode).toBe(400);
  });

  it('treats LIKE wildcards in search literally', async () => {
    await company('Percent 100% Co');
    expect(j(await get('/crm/companies?q=100%25', viewerC)).total).toBe(1);
    expect(j(await get('/crm/companies?q=%25%25%25', viewerC)).total).toBe(0);
  });

  it('refuses to delete a company that still has open deals', async () => {
    const co = await company('Busy Co');
    const deal = j(
      await post('/crm/deals', memberC, { title: 'Big one', companyId: co.id, value: 1000 }),
    );
    const blocked = await del(`/crm/companies/${co.id}`, adminC);
    expect(blocked.statusCode).toBe(409);
    expect(j(blocked).code).toBe('has_open_deals');
    await del(`/crm/deals/${deal.id}`, adminC);
    expect((await del(`/crm/companies/${co.id}`, adminC)).statusCode).toBe(200);
  });
});

describe('leads and conversion', () => {
  it('captures a lead and converts it into a company, contact and deal', async () => {
    const lead = j(
      await post('/crm/leads', memberC, {
        name: 'Grace Hopper',
        email: 'grace@navy.test',
        companyName: 'Navy Labs',
        source: 'Referral',
      }),
    );
    expect(lead.status).toBe('new');
    const res = await post(`/crm/leads/${lead.id}/convert`, memberC, {
      company: { mode: 'new', name: 'Navy Labs' },
      contact: { mode: 'new', name: 'Grace Hopper', email: 'grace@navy.test' },
      deal: { title: 'Navy Labs rollout', value: 25000, currency: 'usd' },
    });
    expect(res.statusCode).toBe(200);
    const out = j(res);
    expect(out.companyId && out.contactId && out.dealId).toBeTruthy();
    const after = j(await get(`/crm/leads/${lead.id}`, memberC));
    expect(after.convertedAt).toBeTruthy();
    expect(after.convertedDealId).toBe(out.dealId);
    const deal = j(await get(`/crm/deals/${out.dealId}`, memberC));
    expect(deal).toMatchObject({
      companyName: 'Navy Labs',
      contactName: 'Grace Hopper',
      status: 'open',
      currency: 'USD',
      value: 25000,
    });
    expect(deal.stageName).toBe('Prospecting');
    // The contact is attached to the new company.
    expect(j(await get(`/crm/contacts/${out.contactId}`, memberC)).companyId).toBe(out.companyId);
  });

  it('blocks a second conversion', async () => {
    const lead = j(await post('/crm/leads', memberC, { name: 'Twice Lead' }));
    const body = {
      company: { mode: 'none' },
      contact: { mode: 'new', name: 'Twice Lead' },
      deal: null,
    };
    expect((await post(`/crm/leads/${lead.id}/convert`, memberC, body)).statusCode).toBe(200);
    const again = await post(`/crm/leads/${lead.id}/convert`, memberC, body);
    expect(again.statusCode).toBe(409);
    expect(j(again).code).toBe('already_converted');
  });

  it('rolls everything back when any part of the conversion fails', async () => {
    await company('Existing Name Inc');
    const lead = j(await post('/crm/leads', memberC, { name: 'Rollback Lead' }));
    // The new company clashes with an existing name, so nothing may be created.
    const res = await post(`/crm/leads/${lead.id}/convert`, memberC, {
      company: { mode: 'new', name: 'Existing Name Inc' },
      contact: { mode: 'new', name: 'Rollback Contact' },
      deal: { title: 'Should not exist' },
    });
    expect(res.statusCode).toBe(409);
    expect(j(await get(`/crm/leads/${lead.id}`, memberC)).convertedAt).toBeNull();
    expect(j(await get('/crm/contacts?q=Rollback%20Contact', memberC)).total).toBe(0);
    expect(j(await get('/crm/deals?q=Should%20not%20exist', memberC)).total).toBe(0);
  });

  it('only members can convert; viewers cannot', async () => {
    const lead = j(await post('/crm/leads', memberC, { name: 'Viewer Lead' }));
    const res = await post(`/crm/leads/${lead.id}/convert`, viewerC, {
      company: { mode: 'none' },
      contact: { mode: 'none' },
      deal: null,
    });
    expect(res.statusCode).toBe(403);
  });

  it('filters leads by status, source and converted state', async () => {
    await post('/crm/leads', memberC, {
      name: 'Filter Lead',
      source: 'Webinar',
      status: 'contacted',
    });
    const hit = j(await get('/crm/leads?status=contacted&source=Webinar&converted=false', viewerC));
    expect(hit.items.map((l: { name: string }) => l.name)).toContain('Filter Lead');
  });
});

describe('deals, pipelines and the board', () => {
  it('creates the default pipeline on first use', async () => {
    const pipelines = j(await get('/crm/pipelines', viewerC)).items;
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0].isDefault).toBe(true);
    expect(pipelines[0].stages.map((s: { name: string }) => s.name)).toEqual([
      'Prospecting',
      'Qualified',
      'Proposal',
      'Negotiation',
      'Won',
      'Lost',
    ]);
  });

  it('moves a deal across stages, setting status and close time for Won and Lost', async () => {
    const deal = j(await post('/crm/deals', memberC, { title: 'Mover', value: 500 }));
    const stages = j(await get('/crm/pipelines', memberC)).items[0].stages as {
      id: string;
      name: string;
    }[];
    const stage = (n: string) => stages.find((s) => s.name === n)!.id;
    const mid = j(
      await post(`/crm/deals/${deal.id}/move`, memberC, { stageId: stage('Proposal') }),
    );
    expect(mid).toMatchObject({
      stageName: 'Proposal',
      status: 'open',
      probability: 50,
      closedAt: null,
    });
    const won = j(await post(`/crm/deals/${deal.id}/move`, memberC, { stageId: stage('Won') }));
    expect(won.status).toBe('won');
    expect(won.closedAt).toBeTruthy();
    const lost = j(await post(`/crm/deals/${deal.id}/move`, memberC, { stageId: stage('Lost') }));
    expect(lost.status).toBe('lost');
    const reopened = j(
      await post(`/crm/deals/${deal.id}/move`, memberC, { stageId: stage('Qualified') }),
    );
    expect(reopened).toMatchObject({ status: 'open', closedAt: null });
    expect(
      (await post(`/crm/deals/${deal.id}/move`, viewerC, { stageId: stage('Won') })).statusCode,
    ).toBe(403);
  });

  it('orders cards within a column using beforeDealId', async () => {
    const mk = async (title: string) => j(await post('/crm/deals', memberC, { title }));
    const d1 = await mk('Order 1');
    const d2 = await mk('Order 2');
    const d3 = await mk('Order 3');
    const stageId = d1.stageId;
    await post(`/crm/deals/${d3.id}/move`, memberC, { stageId, beforeDealId: d1.id });
    const board = j(await get('/crm/deals/board', memberC));
    const col = board.columns.find((c: { id: string }) => c.id === stageId);
    const titles = col.deals
      .map((d: { title: string }) => d.title)
      .filter((x: string) => x.startsWith('Order'));
    expect(titles).toEqual(['Order 3', 'Order 1', 'Order 2']);
    void d2;
  });

  it('rejects moving to a stage of another pipeline, workspace or unknown card', async () => {
    const deal = j(await post('/crm/deals', memberC, { title: 'Bad moves' }));
    const other = j(await get('/crm/pipelines', bOwner, B.slug)).items[0].stages[0].id;
    expect((await post(`/crm/deals/${deal.id}/move`, memberC, { stageId: other })).statusCode).toBe(
      400,
    );
    const stages = j(await get('/crm/pipelines', memberC)).items[0].stages;
    const res = await post(`/crm/deals/${deal.id}/move`, memberC, {
      stageId: stages[1].id,
      beforeDealId: deal.id,
    });
    expect(res.statusCode).toBe(400);
  });

  it('board columns carry counts and per-currency totals', async () => {
    await post('/crm/deals', memberC, { title: 'Euro deal', value: 100, currency: 'EUR' });
    await post('/crm/deals', memberC, { title: 'Euro deal 2', value: 50.5, currency: 'EUR' });
    await post('/crm/deals', memberC, { title: 'Dollar deal', value: 10, currency: 'USD' });
    const board = j(await get('/crm/deals/board?q=deal', viewerC));
    const first = board.columns[0];
    expect(first.count).toBeGreaterThanOrEqual(3);
    expect(first.totals.EUR).toBeGreaterThanOrEqual(150.5);
    expect(first.totals.USD).toBeGreaterThanOrEqual(10);
  });

  it('validates currency and value', async () => {
    expect(
      (await post('/crm/deals', memberC, { title: 'Bad cur', currency: 'dollars' })).statusCode,
    ).toBe(400);
    expect((await post('/crm/deals', memberC, { title: 'Neg', value: -1 })).statusCode).toBe(400);
  });

  it('pipelines: admins add stages, reorder them, and cannot remove a stage in use', async () => {
    const created = j(await post('/crm/pipelines', adminC, { name: 'Partners' }));
    expect(created.stages).toHaveLength(6);
    const added = j(
      await post(`/crm/pipelines/${created.id}/stages`, adminC, { name: 'Legal', probability: 60 }),
    );
    const names = added.stages.map((s: { name: string }) => s.name);
    // New open stages go before the closing stages.
    expect(names.indexOf('Legal')).toBeLessThan(names.indexOf('Won'));
    const ids = added.stages.map((s: { id: string }) => s.id).reverse();
    const reordered = j(
      await call({
        method: 'PUT',
        url: `/crm/pipelines/${created.id}/stage-order`,
        slug: A.slug,
        cookie: adminC,
        payload: { stageIds: ids },
      }),
    );
    expect(reordered.stages.map((s: { id: string }) => s.id)).toEqual(ids);
    const incomplete = await call({
      method: 'PUT',
      url: `/crm/pipelines/${created.id}/stage-order`,
      slug: A.slug,
      cookie: adminC,
      payload: { stageIds: ids.slice(1) },
    });
    expect(incomplete.statusCode).toBe(400);

    const deal = j(
      await post('/crm/deals', memberC, { title: 'In Partners', pipelineId: created.id }),
    );
    const inUse = await del(`/crm/stages/${deal.stageId}`, adminC);
    expect(inUse.statusCode).toBe(409);
    expect((await del(`/crm/pipelines/${created.id}`, adminC)).statusCode).toBe(409);
    expect(
      (await del(`/crm/pipelines/${j(await get('/crm/pipelines', adminC)).items[0].id}`, adminC))
        .statusCode,
    ).toBe(409);
  });

  it('won and lost cannot both be set on a stage', async () => {
    const p = j(await get('/crm/pipelines', adminC)).items[0];
    const res = await post(`/crm/pipelines/${p.id}/stages`, adminC, {
      name: 'Both',
      probability: 0,
      isWon: true,
      isLost: true,
    });
    expect(res.statusCode).toBe(400);
  });

  it('audits create, update, move and delete', async () => {
    const deal = j(await post('/crm/deals', memberC, { title: 'Audited' }));
    const stages = j(await get('/crm/pipelines', memberC)).items[0].stages;
    await post(`/crm/deals/${deal.id}/move`, memberC, { stageId: stages[2].id });
    await patch(`/crm/deals/${deal.id}`, memberC, { value: 12 });
    await del(`/crm/deals/${deal.id}`, adminC);
    const db = adminDb();
    try {
      const rows = await db.db.tenant(A.orgId).auditLogs.find({ targetId: deal.id });
      expect(rows.map((r) => r.action).sort()).toEqual([
        'crm.deal_created',
        'crm.deal_deleted',
        'crm.deal_moved',
        'crm.deal_updated',
      ]);
    } finally {
      await db.close();
    }
  });
});

describe('activities and notes', () => {
  it('logs, completes and lists activities, with overdue items first-class', async () => {
    const co = await company('Activity Co');
    const past = new Date(Date.now() - 86400_000).toISOString();
    const a = j(
      await post('/crm/activities', memberC, {
        type: 'call',
        subject: 'Intro call',
        dueAt: past,
        linkedType: 'company',
        linkedId: co.id,
      }),
    );
    expect(a.assigneeId).toBeTruthy();
    const overdue = j(await get('/crm/activities?status=overdue', viewerC));
    expect(overdue.items.map((x: { id: string }) => x.id)).toContain(a.id);
    const done = j(await post(`/crm/activities/${a.id}/complete`, memberC, { done: true }));
    expect(done.completedAt).toBeTruthy();
    expect(
      j(await get('/crm/activities?status=overdue', viewerC)).items.map(
        (x: { id: string }) => x.id,
      ),
    ).not.toContain(a.id);
    expect(
      j(await get(`/crm/activities?linkedType=company&linkedId=${co.id}&status=done`, viewerC))
        .total,
    ).toBe(1);
    const undone = j(await post(`/crm/activities/${a.id}/complete`, memberC, { done: false }));
    expect(undone.completedAt).toBeNull();
  });

  it('requires a real linked record and a matching pair', async () => {
    expect(
      (await post('/crm/activities', memberC, { type: 'task', subject: 'x', linkedType: 'deal' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await post('/crm/activities', memberC, {
          type: 'task',
          subject: 'x',
          linkedType: 'deal',
          linkedId: '00000000-0000-4000-8000-000000000000',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await post('/crm/activities', memberC, { type: 'task', subject: 'standalone' })).statusCode,
    ).toBe(200);
  });

  it('only the owner of an activity or a CRM admin may delete it', async () => {
    const a = j(await post('/crm/activities', memberC, { type: 'task', subject: 'Mine' }));
    const other = await crmUser(A, 'member');
    expect((await del(`/crm/activities/${a.id}`, other.cookie)).statusCode).toBe(403);
    expect((await del(`/crm/activities/${a.id}`, memberC)).statusCode).toBe(200);
  });

  it('notes validate mentions and respect authorship', async () => {
    const co = await company('Notes Co');
    const note = await post('/crm/notes', memberC, {
      body: 'Talked to @someone',
      linkedType: 'company',
      linkedId: co.id,
      mentions: [memberId],
    });
    expect(note.statusCode).toBe(200);
    const outsider = await crmUser(B, 'member');
    const bad = await post('/crm/notes', memberC, {
      body: 'x',
      linkedType: 'company',
      linkedId: co.id,
      mentions: [outsider.id],
    });
    expect(bad.statusCode).toBe(400);
    const list = j(await get(`/crm/notes?linkedType=company&linkedId=${co.id}`, viewerC));
    expect(list.items).toHaveLength(1);
    const other = await crmUser(A, 'member');
    expect(
      (await patch(`/crm/notes/${j(note).id}`, other.cookie, { body: 'hijack' })).statusCode,
    ).toBe(403);
    expect((await patch(`/crm/notes/${j(note).id}`, memberC, { body: 'edited' })).statusCode).toBe(
      200,
    );
    expect((await del(`/crm/notes/${j(note).id}`, adminC)).statusCode).toBe(200);
  });

  it('the dashboard reports open deals, won this month, lead sources and my overdue work', async () => {
    const c = await workspace('crmdash');
    const stages = j(await get('/crm/pipelines', c.owner, c.slug)).items[0].stages;
    await post('/crm/deals', c.owner, { title: 'D1', value: 100 }, c.slug);
    await post('/crm/deals', c.owner, { title: 'D2', value: 300 }, c.slug);
    const won = j(await post('/crm/deals', c.owner, { title: 'D3', value: 700 }, c.slug));
    await post(
      `/crm/deals/${won.id}/move`,
      c.owner,
      { stageId: stages.find((s: { isWon: boolean }) => s.isWon).id },
      c.slug,
    );
    await post('/crm/leads', c.owner, { name: 'L1', source: 'Web' }, c.slug);
    await post('/crm/leads', c.owner, { name: 'L2', source: 'Web' }, c.slug);
    await post('/crm/leads', c.owner, { name: 'L3' }, c.slug);
    await post(
      '/crm/activities',
      c.owner,
      { type: 'task', subject: 'Late', dueAt: new Date(Date.now() - 3600_000).toISOString() },
      c.slug,
    );
    const d = j(await get('/crm/dashboard', c.owner, c.slug));
    const open = d.openDealsByStage.filter((r: { currency: string }) => r.currency === 'USD');
    expect(open.reduce((s: number, r: { count: number }) => s + r.count, 0)).toBe(2);
    expect(open.reduce((s: number, r: { total: number }) => s + r.total, 0)).toBe(400);
    expect(d.wonThisMonth).toEqual([{ currency: 'USD', count: 1, total: 700 }]);
    expect(d.leadsBySource[0]).toEqual({ source: 'Web', count: 2 });
    expect(d.leads.open).toBe(3);
    expect(d.myOverdue).toHaveLength(1);
  });
});

describe('import and export', () => {
  const csv = (rows: string[]) => rows.join('\n');

  it('parses quoted CSV with commas, quotes and newlines', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n"line1\nline2",z\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['line1\nline2', 'z'],
    ]);
    expect(parseCsv('﻿h\n1')).toEqual([['h'], ['1']]);
  });

  it('dry-run reports row errors without writing', async () => {
    const res = await post('/crm/import/leads', adminC, {
      csv: csv([
        'Name,Email,Status',
        'Ok One,ok@x.test,new',
        ',missing@x.test,new',
        'Bad Mail,nope,new',
        'Bad Status,b@x.test,hot',
      ]),
      mapping: { name: 'Name', email: 'Email', status: 'Status' },
      dryRun: true,
    });
    expect(res.statusCode).toBe(200);
    const out = j(res);
    expect(out.total).toBe(4);
    expect(out.validRows).toBe(1);
    expect(
      out.errors.map((e: { row: number; field: string }) => `${e.row}:${e.field}`).sort(),
    ).toEqual(['3:name', '4:email', '5:status']);
    expect(out.created).toBe(0);
    expect(j(await get('/crm/leads?q=Ok%20One', adminC)).total).toBe(0);
  });

  it('is all-or-nothing: one bad row rejects the file', async () => {
    const res = await post('/crm/import/leads', adminC, {
      csv: csv(['Name,Email', 'Good Row,g@x.test', 'Bad Row,nope']),
      mapping: { name: 'Name', email: 'Email' },
    });
    expect(res.statusCode).toBe(422);
    expect(j(res).created).toBe(0);
    expect(j(await get('/crm/leads?q=Good%20Row', adminC)).total).toBe(0);
  });

  it('imports valid rows, links contacts to companies, and audits the import', async () => {
    const c = await post('/crm/import/companies', adminC, {
      csv: csv(['Company,Site', 'Imp Co One,https://one.test', 'Imp Co Two,']),
      mapping: { name: 'Company', website: 'Site' },
    });
    expect(c.statusCode).toBe(200);
    expect(j(c).created).toBe(2);
    const dup = await post('/crm/import/companies', adminC, {
      csv: csv(['Company', 'imp co one']),
      mapping: { name: 'Company' },
    });
    expect(dup.statusCode).toBe(422);
    const contacts = await post('/crm/import/contacts', adminC, {
      csv: csv(['Name,Email,Company', 'Imp Person,imp@x.test,Imp Co One']),
      mapping: { name: 'Name', email: 'Email', company: 'Company' },
    });
    expect(contacts.statusCode).toBe(200);
    expect(j(await get('/crm/contacts?q=Imp%20Person', adminC)).items[0].companyName).toBe(
      'Imp Co One',
    );
    const unknown = await post('/crm/import/contacts', adminC, {
      csv: csv(['Name,Company', 'Z,No Such Co']),
      mapping: { name: 'Name', company: 'Company' },
    });
    expect(unknown.statusCode).toBe(422);
  });

  it('enforces mapping and row limits', async () => {
    expect(
      (await post('/crm/import/leads', adminC, { csv: 'Name\nx', mapping: {} })).statusCode,
    ).toBe(400);
    expect(
      (await post('/crm/import/leads', adminC, { csv: 'Name\nx', mapping: { name: 'Nope' } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await post('/crm/import/leads', adminC, { csv: 'Name', mapping: { name: 'Name' } }))
        .statusCode,
    ).toBe(400);
    const big = ['Name', ...Array.from({ length: 5001 }, (_, i) => `n${i}`)].join('\n');
    expect(
      (
        await post('/crm/import/leads', adminC, {
          csv: big,
          mapping: { name: 'Name' },
          dryRun: true,
        })
      ).statusCode,
    ).toBe(400);
  });

  it('exports CSV with a BOM and neutralises spreadsheet formulas', async () => {
    await company('=HYPERLINK("http://evil.test","click")');
    await company('Plain, "quoted" Co');
    const res = await get('/crm/export/companies', adminC);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('crm-companies.csv');
    const body = res.rawPayload.toString('utf8');
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body).toContain(`"'=HYPERLINK(""http://evil.test"",""click"")"`);
    expect(body).toContain('"Plain, ""quoted"" Co"');
    expect(body).not.toMatch(/(^|\r\n)=HYPERLINK/);
  });
});

describe('tenant isolation', () => {
  it('another workspace can neither see nor change this workspace’s CRM data', async () => {
    const co = await company('Secret Co Isolation');
    const lead = j(await post('/crm/leads', memberC, { name: 'Secret Lead Isolation' }));
    const deal = j(await post('/crm/deals', memberC, { title: 'Secret Deal Isolation' }));
    const note = j(
      await post('/crm/notes', memberC, { body: 'secret', linkedType: 'company', linkedId: co.id }),
    );
    const act = j(
      await post('/crm/activities', memberC, { type: 'task', subject: 'Secret Task Isolation' }),
    );

    for (const path of ['companies', 'leads', 'deals']) {
      const list = j(await get(`/crm/${path}?q=Isolation`, bOwner, B.slug));
      expect(list.total).toBe(0);
    }
    expect(
      j(await get('/crm/activities', bOwner, B.slug)).items.map((x: { id: string }) => x.id),
    ).not.toContain(act.id);
    expect(
      j(await get('/crm/deals/board?q=Isolation', bOwner, B.slug)).columns.every(
        (c: { count: number }) => c.count === 0,
      ),
    ).toBe(true);
    expect((await get(`/crm/companies/${co.id}`, bOwner, B.slug)).statusCode).toBe(404);
    expect((await get(`/crm/leads/${lead.id}`, bOwner, B.slug)).statusCode).toBe(404);
    expect((await get(`/crm/deals/${deal.id}`, bOwner, B.slug)).statusCode).toBe(404);
    expect(
      (await patch(`/crm/companies/${co.id}`, bOwner, { industry: 'hacked' }, B.slug)).statusCode,
    ).toBe(404);
    expect((await del(`/crm/deals/${deal.id}`, bOwner, B.slug)).statusCode).toBe(404);
    expect(
      (await post(`/crm/deals/${deal.id}/move`, bOwner, { stageId: deal.stageId }, B.slug))
        .statusCode,
    ).toBe(404);
    expect((await patch(`/crm/notes/${note.id}`, bOwner, { body: 'x' }, B.slug)).statusCode).toBe(
      404,
    );
    expect(
      (await post(`/crm/activities/${act.id}/complete`, bOwner, { done: true }, B.slug)).statusCode,
    ).toBe(404);
    expect(
      (
        await post(
          `/crm/leads/${lead.id}/convert`,
          bOwner,
          { company: { mode: 'none' }, contact: { mode: 'none' }, deal: null },
          B.slug,
        )
      ).statusCode,
    ).toBe(404);
    // Linking to a record from another workspace is refused.
    expect(
      (await post('/crm/deals', bOwner, { title: 'Cross', companyId: co.id }, B.slug)).statusCode,
    ).toBe(400);
    expect(
      (
        await post(
          '/crm/activities',
          bOwner,
          { type: 'task', subject: 'x', linkedType: 'company', linkedId: co.id },
          B.slug,
        )
      ).statusCode,
    ).toBe(400);
    // The export from B holds none of A's rows.
    const exp = await get('/crm/export/companies', bOwner, B.slug);
    expect(exp.body).not.toContain('Secret Co Isolation');
  });

  it('refuses a deal that points at another workspace’s company', async () => {
    const co = await company('FK Guard Co');
    const pipelines = j(await get('/crm/pipelines', bOwner, B.slug)).items[0];
    const res = await post(
      '/crm/deals',
      bOwner,
      {
        pipelineId: pipelines.id,
        stageId: pipelines.stages[0].id,
        companyId: co.id,
        title: 'FK cross',
      },
      B.slug,
    );
    expect(res.statusCode).toBe(400);
    expect(j(res).fields.companyId).toBeTruthy();
  });
});
