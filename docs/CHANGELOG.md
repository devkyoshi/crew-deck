# Changelog

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
