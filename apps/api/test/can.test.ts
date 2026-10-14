import { describe, expect, it } from 'vitest';
import type { OrgRole } from '@crew-deck/shared';
import { can, type Action, type SpaceRole } from '../src/permissions/can.js';

const actor = (orgRole: OrgRole) => ({ userId: 'u1', orgId: 'o1', orgRole });

// Brief section 5. Columns: owner, org admin, org member.
const ORG_MATRIX: [Action, boolean, boolean, boolean][] = [
  ['member.invite', true, true, false],
  ['member.deactivate', true, true, false],
  ['member.editProfile', true, true, false],
  ['group.manage', true, true, false],
  ['space.create', true, true, true],
  ['space.viewAll', true, true, false],
  ['space.delete', true, true, false],
  ['space.edit', true, true, false],
  ['space.manageMembers', true, true, false],
  ['accessRequest.approve', true, true, false],
  ['audit.viewOrg', true, true, false],
  ['settings.manage', true, true, false],
  ['attendance.viewAll', true, true, false],
  ['attendance.export', true, true, false],
  ['audit.viewSpace', true, true, false],
];

describe('can(): org roles', () => {
  for (const [action, owner, admin, member] of ORG_MATRIX) {
    it(`${action}: owner=${owner} admin=${admin} member=${member}`, () => {
      expect(can(actor('owner'), action)).toBe(owner);
      expect(can(actor('admin'), action)).toBe(admin);
      expect(can(actor('member'), action)).toBe(member);
    });
  }

  it('lets owners change any role', () => {
    expect(can(actor('owner'), 'member.changeRole', { targetOrgRole: 'owner' })).toBe(true);
    expect(can(actor('owner'), 'member.changeRole', { targetOrgRole: 'member' })).toBe(true);
  });

  it('lets admins change roles, but not owners', () => {
    expect(can(actor('admin'), 'member.changeRole', { targetOrgRole: 'member' })).toBe(true);
    expect(can(actor('admin'), 'member.changeRole', { targetOrgRole: 'admin' })).toBe(true);
    expect(can(actor('admin'), 'member.changeRole', { targetOrgRole: 'owner' })).toBe(false);
  });

  it('never lets members change roles', () => {
    expect(can(actor('member'), 'member.changeRole', { targetOrgRole: 'member' })).toBe(false);
  });
});

describe('can(): viewing spaces', () => {
  it('lets owners and admins see every space, including private ones', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(can(actor(role), 'space.view', { spaceVisibility: 'private', spaceRole: null })).toBe(
        true,
      );
    }
  });

  it('lets members see open spaces, and private ones only when they have a space role', () => {
    expect(can(actor('member'), 'space.view', { spaceVisibility: 'open', spaceRole: null })).toBe(
      true,
    );
    expect(
      can(actor('member'), 'space.view', { spaceVisibility: 'private', spaceRole: null }),
    ).toBe(false);
    for (const spaceRole of ['admin', 'member', 'viewer'] as SpaceRole[]) {
      expect(can(actor('member'), 'space.view', { spaceVisibility: 'private', spaceRole })).toBe(
        true,
      );
    }
  });
});

describe('can(): space roles (for an org member)', () => {
  const check = (action: Action, spaceRole: SpaceRole | null) =>
    can(actor('member'), action, { spaceRole });

  // Space admin: Yes on edit, manage members, approve requests, space audit. Member/viewer: No.
  for (const action of [
    'space.edit',
    'space.manageMembers',
    'accessRequest.approve',
    'audit.viewSpace',
  ] as Action[]) {
    it(`${action}: only space admins`, () => {
      expect(check(action, 'admin')).toBe(true);
      expect(check(action, 'member')).toBe(false);
      expect(check(action, 'viewer')).toBe(false);
      expect(check(action, null)).toBe(false);
    });
  }

  it('does not give space admins any org-level power', () => {
    for (const action of [
      'member.invite',
      'member.deactivate',
      'group.manage',
      'space.viewAll',
      'audit.viewOrg',
    ] as Action[]) {
      expect(can(actor('member'), action, { spaceRole: 'admin' })).toBe(false);
    }
    expect(
      can(actor('member'), 'member.changeRole', { spaceRole: 'admin', targetOrgRole: 'member' }),
    ).toBe(false);
  });
});

describe('can(): unknown actions', () => {
  it('denies anything it does not know', () => {
    expect(can(actor('owner'), 'something.else' as Action)).toBe(false);
  });
});

describe('can(): work days', () => {
  const asRole = (role: 'owner' | 'admin' | 'member') => ({
    userId: 'u1',
    orgId: 'o1',
    orgRole: role,
  });

  it('lets the person, their manager and admins see times and make corrections; nobody else', () => {
    for (const action of ['workday.viewTimes', 'workday.editOthers'] as const) {
      expect(can(asRole('member'), action, { isSelf: true })).toBe(true);
      expect(can(asRole('member'), action, { isManager: true })).toBe(true);
      expect(can(asRole('admin'), action)).toBe(true);
      expect(can(asRole('owner'), action)).toBe(true);
      expect(can(asRole('member'), action)).toBe(false);
      expect(can(asRole('member'), action, { isSelf: false, isManager: false })).toBe(false);
    }
  });
});

describe('can(): CRM roles', () => {
  type Crm = 'none' | 'viewer' | 'member' | 'admin' | undefined;
  const crm = (orgRole: OrgRole, crmRole: Crm) => ({ userId: 'u1', orgId: 'o1', orgRole, crmRole });
  // Columns: view, edit, admin.
  const TABLE: [OrgRole, Crm, boolean, boolean, boolean][] = [
    ['member', 'none', false, false, false],
    ['member', 'viewer', true, false, false],
    ['member', 'member', true, true, false],
    ['member', 'admin', true, true, true],
    ['member', undefined, false, false, false],
    ['admin', 'none', true, true, true],
    ['owner', 'none', true, true, true],
  ];
  for (const [org, role, view, edit, admin] of TABLE) {
    it(`org ${org} with CRM role ${role}: view=${view} edit=${edit} admin=${admin}`, () => {
      expect(can(crm(org, role), 'crm.view')).toBe(view);
      expect(can(crm(org, role), 'crm.edit')).toBe(edit);
      expect(can(crm(org, role), 'crm.admin')).toBe(admin);
    });
  }
});

describe('can(): work item depth (comments, links, watching, attachments)', () => {
  const m = actor('member');
  const as = (spaceRole: SpaceRole | null, extra: object = {}) => ({ spaceRole, spaceVisibility: 'private' as const, ...extra });

  it('lets space members and admins comment, link, duplicate and attach; viewers only watch', () => {
    for (const action of ['comment.create', 'item.link', 'item.duplicate', 'attachment.add'] as Action[]) {
      expect(can(m, action, as('admin'))).toBe(true);
      expect(can(m, action, as('member'))).toBe(true);
      expect(can(m, action, as('viewer'))).toBe(false);
      expect(can(actor('admin'), action, as(null))).toBe(true);
    }
    expect(can(m, 'item.watch', as('viewer'))).toBe(true);
    expect(can(m, 'item.watch', as(null))).toBe(false);
  });

  it('lets people edit only their own comments, and space admins delete anyone’s', () => {
    expect(can(m, 'comment.editOwn', as('member', { isAuthor: true }))).toBe(true);
    expect(can(m, 'comment.editOwn', as('member', { isAuthor: false }))).toBe(false);
    expect(can(m, 'comment.editOwn', as('admin', { isAuthor: false }))).toBe(false);
    // A viewer who once commented (before losing the member role) cannot edit any more.
    expect(can(m, 'comment.editOwn', as('viewer', { isAuthor: true }))).toBe(false);
    expect(can(m, 'comment.deleteAny', as('admin'))).toBe(true);
    expect(can(m, 'comment.deleteAny', as('member'))).toBe(false);
  });

  it('lets members remove their own attachments and transfer only what they reported', () => {
    expect(can(m, 'attachment.delete', as('member', { isAuthor: true }))).toBe(true);
    expect(can(m, 'attachment.delete', as('member', { isAuthor: false }))).toBe(false);
    expect(can(m, 'attachment.delete', as('admin'))).toBe(true);
    expect(can(m, 'item.transfer', as('member', { isReporter: true }))).toBe(true);
    expect(can(m, 'item.transfer', as('member', { isReporter: false }))).toBe(false);
    expect(can(m, 'item.transfer', as('viewer', { isReporter: true }))).toBe(false);
  });
});
