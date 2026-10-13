# Changelog

## 2026-10-13 - Phase 4: Spaces

- Migration 0005: spaces, space_members, space_stars (RLS, composite tenant foreign keys, soft delete for key reuse protection).
- API: list (visibility, status, mine, starred, search, pagination), get by id or key, create (with initial members and groups), update, archive, restore, delete (admin only, key confirmation), star. Effective role from direct and group membership.
- Web: spaces directory (cards or table, filters, my spaces), 4-step create wizard, space overview, read-only members tab, settings (general, access, danger zone), sidebar Starred and Recent, top-bar space switcher.
- Playwright: create a private space, hidden from others, star, edit, archive, restore, admin delete.

## 2026-10-13 - Phase 3: Groups

- Migration 0004: groups, group_members (RLS, composite foreign keys), invitations.group_ids.
- API: list, get, create, update, delete, replace members (all audited); groups on the member profile; invite into groups.
- Web: groups list and detail, create and edit dialog, reusable searchable people and group pickers, groups on the member profile, group step in the invite form.
- Tests now run on a separate database (crewdeck_test). Dev seed adds demo people (admin, member, member2).

## 2026-10-13 - Phase 2: Members and invitations

- Migration 0003: memberships.status / deactivated_at, append-only audit_logs (RLS), per-workspace status in the sign-in lookup functions.
- API: members list/get/patch/deactivate/reactivate, invitations list/bulk create/resend/revoke, audit-logs list. Last-owner protection, admins cannot touch owners, every action audited.
- Invite emails: BullMQ queue + worker, Brevo sender (logs the link when no API key), 7-day expiry, resend replaces the old link.
- Web: members table (search, filters, sort, pagination, row actions, bulk select), 3-step invite dialog, pending invites tab, member profile page, People directory, edit own profile.
- Tests: 100+ API tests (permissions allowed/denied, cross-tenant, audit, Brevo sender) and Playwright flow for invite, accept, list, deactivate, blocked login.

## 2026-10-13 - UI restyle from reference images

- Cool grey page with an inset white rounded panel, bright blue accent, 16px card radius, soft rounded-square buttons and inputs, segmented-pill tabs, blue active sidebar pill.
- New shared pieces: toned column headers, chips, tone pills, avatar stack, icon tiles, hero banner (SVG illustration, no external images).
- Home redesigned with hero banner and shortcut cards; /design page shows the new card and header styles.

## 2026-10-13 - Phase 1: Authentication and app shell

- Migration 0002: users.password_hash, invitations table (RLS), pre-tenant lookup functions.
- Auth API: password login, dev-only login, logout, invite preview/accept, Google SSO (ticket handoff), GET/PATCH /me, rate limiting, Origin check.
- Redis sessions bound to tenant; tenant resolved from host (subdomain).
- can() permission module with matrix tests; API tests for sessions, cross-tenant, invites, SSO, rate limits (60 tests).
- Web: sign-in, accept-invite, workspace picker, route protection (proxy.ts + server check), app shell (sidebar, top bar, breadcrumbs, user menu, command palette, tenant switcher), /design page, softer warm theme.
- Playwright smoke tests (sign-in, invite, member vs admin nav, palette, desktop/tablet/mobile).

## 2026-10-13 - Phase 0: Foundation

- pnpm monorepo: `apps/web` (Next.js, Tailwind, shadcn/ui, light/dark), `apps/api` (Fastify), `packages/shared`.
- Postgres schema (`organizations`, `users`, `memberships`) with row-level security, plus reversible SQL migrations.
- `withTenant()` helper, restricted `crew_app` DB role, seed script (tenants `acme`, `globex`, one owner each).
- Redis/BullMQ helpers (tenant-prefixed keys, jobs carry `orgId`).
- Dockerfiles, docker-compose (Postgres + Redis; `full` profile adds api + web), Makefile (`make dev`), GitHub Actions CI.
- Tests: direct-DB RLS isolation, API cross-tenant scaffold, seed owners, health and error shape.
