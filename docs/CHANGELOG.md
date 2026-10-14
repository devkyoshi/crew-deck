# Changelog

## 2026-10-14 - Guided, photo-led signed-out screens

- One shared split layout for every signed-out screen (photo and message beside the task; a short banner on phones): sign-in, find workspace, accept invitation, platform sign-in, sign-up and verify. Six Unsplash photos downloaded into `apps/web/public/auth` with `CREDITS.md`.
- Sign-up is now conversational: you, company and address (live check, free alternatives when taken), review, then "check your inbox" with a resend cooldown. Verify is guided too: confirm your name, choose a password (strength guide), then a ready screen that carries you to the workspace.
- Navigation: the step is in the URL, so the browser Back and Forward buttons and refresh work; answers are kept for the tab; you cannot skip ahead; completed steps in the progress bar are buttons; focus moves to each new heading; the whole flow works from the keyboard.
- Pricing page: photo hero, "Most popular" plan, three-step "how it works", FAQ and closing call to action.
- Accept invitation is two steps (name, password). Sign-in remembers workspaces and the finder lists recent ones.
- API: the name given at sign-up is stored and returned by the verify preview (migration 0010).
- Tests: stepped sign-up flows, browser Back and refresh, no skipping ahead, keyboard-only, expired links, per-step accessibility scans; invite flows updated.

## 2026-10-14 - Phase 9: Plans, self-serve sign-up and the platform console

- Docs: docs/FEATURES.md (every feature with its plan gate key) and docs/PRICING.md (Free, Team, Business).
- Migration 0009: plans (seeded), workspace status, plan, trial, limit overrides, branding and domain-lock columns, platform admins, platform settings, sign-up requests, platform audit log; narrow SECURITY DEFINER functions; tenants can only edit their own branding.
- Plans and limits enforced on the server: seats (including waiting invitations), spaces, sites, CRM records, pipelines, CRM import and export, attendance export, per-space audit log, audit history window, branding, domain-locked invitations. Soft blocks (402) that keep all data.
- Self-serve sign-up: public pricing and sign-up pages, live address check, emailed verification link, one-transaction workspace creation, 14-day Business trial then Free, free email providers allowed (platform setting can block them).
- Suspension: refused at the tenant gate (sign-in, invitations, open sessions); a suspended workspace's sign-in page explains why.
- Platform console at /platform: sign-in, workspaces list and search, create (owner invited by email), suspend and restore, change plan, set trials and custom limits, usage, platform settings, read-only impersonation with audit in both logs.
- Workspace screens: Plan and billing (usage against limits, plan comparison), Branding and access (name, logo, accent colour with contrast check, domain lock), trial and impersonation banners, locked-feature buttons.
- Sign-up email failures now say so instead of failing silently; `EMAIL_MODE=log` for browser tests; `db:platform-admin` script for the first platform admin.
- Tests: plan limits and locks at their boundaries, trials with the clock, sign-up end to end (tokens, expiry, existing accounts, free email, isolation), suspension, platform permissions and impersonation, database-level grants; browser flows for sign-up, suspension, restore, plan change and impersonation; new pages in the accessibility scans.

## 2026-10-14 - Phase 8: CRM

- Migration 0008: memberships.crm_role, CRM tables (tags, companies, contacts, leads, pipelines, stages, deals, activities, notes, record tags), all with RLS and composite tenant foreign keys; `crm` added to the workspace modules.
- API: CRUD with search, filters and paging for companies, contacts, leads and deals; lead conversion (one transaction, no double conversion); deal move with fractional ordering and won/lost handling; deals board with per-currency totals; pipelines and stages (add, edit, reorder, delete with in-use checks); activities (complete, overdue) and notes with validated mentions; tags; dashboard; CSV import (dry run, row errors, all-or-nothing, 5,000 rows) and spreadsheet-safe CSV export; CRM module switch and per-member CRM role; audit entries for every change.
- Web: CRM sidebar group; dashboard; leads, contacts and companies lists and record pages with activity and notes; deals board (drag and drop, keyboard, card menu, quick add) and table; lead conversion dialog; import wizard; Administration > CRM (module switch, pipeline editor); CRM access on member profiles.
- Demo workspace now includes tags, companies, contacts, leads, a pipeline with deals in every stage, activities (two overdue) and notes.
- Tests: 37 CRM API tests (roles, tenant isolation including search and linking, conversion rollback, move rules, import validation, CSV safety, dashboard figures, database-level foreign keys) and `can()` rows; six browser flows (capture, convert, move, log activity, import, keyboard drag, roles, module switch, pipeline editing); CRM pages added to the accessibility scans and the error-free walk-through.

## 2026-10-13 - Phase 7: Daily check-in and check-out

- Migration 0007: tenant_settings, sites, holidays, work_days, work_day_edits (append-only), memberships.reports_to, workspace-listing function for the job.
- API: check in and out, today, week, weekly plan, team board (group and space filters), history with role-scoped access, corrections (and adding a missing day), CSV export, work settings, sites and holidays CRUD, reports-to with loop protection; the check-in module can be switched off per workspace.
- Auto-close of forgotten check-outs as per-workspace background jobs, in each person's own timezone.
- Web: top-bar check-in control, My day (today, weekly plan, history, corrections), Team board (also a Home widget, refreshes every 15 seconds), Attendance (admin, CSV), Settings > Work (hours, sites, holidays).
- Demo workspace now includes sites, holidays, managers, today's statuses and two weeks of history.
- Tests: timezone and DST unit tests, 32 check-in API tests (visibility, permissions, corrections, auto-close, export, settings, database constraints), five browser flows including "teammates see a check-in within seconds"; accessibility fixes (contrast, ARIA).

## 2026-10-13 - Phase 6: Hardening and polish

- Accessibility: axe scans of every screen (light and dark) and open overlays, keyboard tests, contrast and ARIA fixes, toggle-button pickers.
- Resilience: error boundaries, not-found pages, route loading skeletons, automatic return to sign-in when a session ends.
- Tests: full-product walk-through that fails on any console error or failed request; 41 browser tests in total; performance guard with 5,000 people, 1,500 spaces and a 2,000-person group; header tests. Test database is recreated every run.
- Demo: richer demo workspace (people, teams, open, private and archived spaces, group access, stars, a pending request, audit trail), included in `make dev`.
- Security headers on both apps; group member list paged in the browser.
- Docker: migrate and seed services, API health check, API waits for migrations; verified from an empty database in an isolated compose project.
- CI: separate end-to-end job (Postgres and Redis services, migrate, seed, Playwright with trace upload on failure).
- README and docs/DEPLOYMENT.md.

## 2026-10-13 - Phase 5: Space access

- Migration 0006: space_access_requests (RLS, composite tenant foreign keys, one pending request per person per space).
- API: space members list (search, effective and inherited roles), add, change role, remove with last-admin protection; access requests (request with identical answers, inbox, mine, approve with role, decline, cancel); per-space audit log; initial space members are now audited too.
- Web: full Members tab with add dialog, role change and remove; Request access page; Access requests inbox with pending badge in the sidebar; org-wide Audit log page (filters by person, action and dates, expandable details); space overview shows recent changes to space admins.
- Tests: a permission matrix test runs every row of section 5 for all six roles through the real routes; 38 more API tests; Playwright flows for request, approve, group access and audit.

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
