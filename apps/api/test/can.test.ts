import { describe, expect, it } from 'vitest';
import type { OrgRole } from '@crew-deck/shared';
import { can, type Action, type SpaceRole } from '../src/permissions/can.js';

const actor = (orgRole: OrgRole) => ({ userId: 'u1', orgId: 'o1', orgRole });

// Brief section 5. Columns: owner, org admin, org member.
const ORG_MATRIX: [Action, boolean, boolean, boolean][] = [
  ['member.invite', true, true, false],
  ['member.deactivate', true, true, false],
  ['group.manage', true, true, false],
  ['space.create', true, true, true],
  ['space.viewAll', true, true, false],
  ['space.edit', true, true, false],
  ['space.manageMembers', true, true, false],
  ['accessRequest.approve', true, true, false],
  ['audit.viewOrg', true, true, false],
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
