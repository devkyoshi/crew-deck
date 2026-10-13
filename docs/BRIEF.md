# Company Workspace Platform: Build Brief

Oct 13, 2026

## 1. Overview

We are building a multi-tenant company platform (Jira/Slack-style) that we use internally first and can sell to other companies later. It covers members, groups and spaces with access managed per space, daily check-in/check-out status, and a lightweight CRM. The build starts with the foundation and a polished UI, so later modules (work items, boards, chat, BA tools) plug into it.

**Goals**

- Admins can create and invite company members, and deactivate them when they leave
- Admins and space owners can create spaces, manage their settings, and assign members and groups with roles
- Users see only the spaces they can access, in a clean Jira/Slack-like interface
- Every access change is recorded in an audit log

* Every company is an isolated tenant: no data, user or file is ever visible across tenants
* Members check in and out each day and set where they work (onsite, remote, offsite), and teams see who is where
* Teams manage companies, contacts, leads and deals in a built-in CRM

**Non-goals for this phase (do not build)**

- Work items, boards, sprints, workflows
- Chat, channels, DMs, presence
- Wiki/docs, BA module, requirements, traceability
- Leave balances and approval workflows, payroll integration, GPS or geofencing
- Guests or external users, client portal, SCIM, payment processing and subscription billing (design for them, do not build them)
- Custom permission schemes (use fixed roles)

If a task seems to need one of these, stop and ask instead of adding it.

## 2. Working agreement for Claude

Follow these rules on every task in this project.

1. **Build one phase at a time.** Do not start a phase until the previous one meets its done criteria (section 7).
2. **Stay in scope.** Section 1 lists the non-goals. Do not add features, tables or endpoints that are not in this brief without asking.
3. **Plan before coding.** For each phase, first reply with a short plan (files to create, migrations, endpoints, screens) and wait for approval.
4. **Small, reviewable changes.** Commit per logical unit, with clear messages. Run the linter, type-check and tests before declaring anything done.
5. **Enforce permissions on the server.** The UI hides what users cannot do, but the API must reject it. Every endpoint checks the caller's tenant and role.
6. **Reuse before creating.** Use shadcn/ui components and shared layout components. Do not hand-roll a component that shadcn provides.
7. **No silent decisions.** If the brief is ambiguous or you must choose between two designs, list the options and ask.
8. **Keep a changelog.** Maintain a `docs/CHANGELOG.md` and `docs/DECISIONS.md` (short ADR entries) as you go.

## 3. Tech stack and structure

These are the proposed defaults; change any row before the build starts.

| Layer         | Choice                                                                                 | Notes                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Frontend      | Next.js (App Router) + TypeScript                                                      | Server components where useful, client components for interactive screens                                                       |
| UI            | shadcn/ui + Tailwind CSS + lucide-react                                                | Add components via the shadcn CLI, theme with CSS variables                                                                     |
| Forms         | react-hook-form + zod                                                                  | One zod schema shared by form and API where possible                                                                            |
| Data fetching | TanStack Query                                                                         | Tables via TanStack Table                                                                                                       |
| Backend       | Node.js + Fastify + TypeScript                                                         | Schema-validated routes (zod), plugin-per-module structure                                                                      |
| Database      | PostgreSQL                                                                             | Shared schema, tenant\_id on every table, row-level security (section 10). Migrations with a versioned tool (Drizzle or Prisma) |
| Cache/queue   | Redis + BullMQ                                                                         | Invite emails and background jobs only for now                                                                                  |
| Auth          | Email invites + Google/Microsoft SSO restricted to each tenant's verified email domain | Sessions via secure httpOnly cookies                                                                                            |
| Email         | SendGrid                                                                               | For invites and notifications                                                                                                   |
| Tooling       | pnpm monorepo, ESLint, Prettier, Vitest, Playwright                                    | CI runs lint, types and tests                                                                                                   |

**Suggested monorepo layout**

```text
apps/
  web/            # Next.js frontend
  api/            # Fastify backend (modules: auth, members, groups, spaces, audit)
packages/
  shared/         # zod schemas, types, permission constants
  ui/             # shared shadcn-based components (optional)
docs/             # CHANGELOG.md, DECISIONS.md
```

## 4. Domain model

Each organization is a tenant, and org\_id is the tenant key on every business table (section 10). Users and memberships are separate tables so one person can belong to several tenants.

| Table                   | Key fields                                                                                      | Purpose                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| organizations           | id, name, domain, created\_at                                                                   | The tenant: one row per customer company                                                                    |
| users                   | id, email, name, avatar\_url, job\_title, timezone, status, last\_login\_at                     | A person's identity. Status: invited, active, deactivated                                                   |
| memberships             | id, org\_id, user\_id, org\_role                                                                | Links a user to the org. Roles: owner, admin, member                                                        |
| invitations             | id, org\_id, email, org\_role, token\_hash, expires\_at, accepted\_at, revoked\_at, invited\_by | Pending and past invites, with preset groups and spaces                                                     |
| groups                  | id, org\_id, name, description                                                                  | Teams such as Backend, BA, QA                                                                               |
| group\_members          | group\_id, user\_id                                                                             | Group membership                                                                                            |
| spaces                  | id, org\_id, key, name, description, icon, visibility, status, owner\_id                        | A project/space. Key is a short unique code (e.g. ENG). Visibility: open, private. Status: active, archived |
| space\_members          | id, space\_id, principal\_type, principal\_id, space\_role                                      | Access for a user or a group. Roles: admin, member, viewer                                                  |
| space\_access\_requests | id, space\_id, user\_id, message, status, decided\_by                                           | Request access to a private space                                                                           |
| audit\_logs             | id, org\_id, actor\_id, action, target\_type, target\_id, before, after, created\_at            | Every invite, role change, space change and membership change                                               |

**Rules**

- Never hard-delete users. Deactivate them and keep their history.
- A space always has at least one admin; block removing the last one.
- A user's effective space role is the highest role from direct membership and any group membership.
- Space keys are unique per organization and cannot be reused after deletion.

## 5. Roles and permissions

There are two layers: an org role that governs the platform, and a space role that governs one space. Roles are fixed in Phase 1.

**Org roles:** Owner (full control, one or two people), Admin (manages members, groups and all spaces), Member (default).

**Space roles:** Admin (manages the space and its membership), Member (normal participation), Viewer (read-only).

| Action                                   | Owner | Org admin        | Org member  | Space admin    | Space member | Space viewer |
| ---------------------------------------- | ----- | ---------------- | ----------- | -------------- | ------------ | ------------ |
| Invite / deactivate members              | Yes   | Yes              | No          | No             | No           | No           |
| Change org roles                         | Yes   | Yes (not owners) | No          | No             | No           | No           |
| Create / edit groups                     | Yes   | Yes              | No          | No             | No           | No           |
| Create a space                           | Yes   | Yes              | Yes         | n/a            | n/a          | n/a          |
| See all spaces (including private)       | Yes   | Yes              | No          | No             | No           | No           |
| Edit space settings, archive             | Yes   | Yes              | No          | Yes            | No           | No           |
| Add / remove space members, change roles | Yes   | Yes              | No          | Yes            | No           | No           |
| Approve access requests                  | Yes   | Yes              | No          | Yes            | No           | No           |
| View space and its members               | Yes   | Yes              | Open spaces | Yes            | Yes          | Yes          |
| View audit log                           | Yes   | Yes              | No          | Own space only | No           | No           |

The creator of a space becomes its first space admin. Enforce all of the above in a single server-side permission module (`can(user, action, resource)`) that the API routes call, so rules live in one place.

## 6. UI and UX requirements

The interface should feel like Jira and Slack: dense but calm, a persistent left sidebar, a top bar, and a content area with clear page headers. Use shadcn/ui for everything it covers.

**App shell**

- Collapsible left sidebar (shadcn `Sidebar`) with grouped sections: _Workspace_ (Home, People, Groups), _Spaces_ (Starred, Recent, All spaces, with each space as a nested item), and _Administration_ (Members, Groups, Spaces, Audit log, Settings, visible to admins only)
- Top bar with breadcrumbs, global search (`Command` palette, Ctrl/Cmd+K), a space switcher, and a user menu
- Space pages have their own secondary navigation (tabs): Overview, Members, Settings
- Light and dark themes, responsive down to tablet; sidebar becomes a sheet on mobile

**Shared patterns**

- **Data tables** (TanStack Table in shadcn `Table`): search, filter chips, sortable columns, pagination, row actions in a `DropdownMenu`, bulk select with a floating action bar
- **Multi-step forms** (stepper with progress, per-step zod validation, back/next, review step, draft kept in state): used for _Create space_ and _Invite members_
- **Grouped form sections:** related fields in `Card` blocks with a title and helper text; use `Tabs` or `Accordion` for long settings pages
- **Role pickers** with `Select` or `Combobox`; people/group pickers as searchable multi-select with avatars
- **Feedback:** `Sonner` toasts, inline field errors, `AlertDialog` for destructive actions, empty states with a clear call to action, `Skeleton` loading states
- Consistent page header: title, description, primary action on the right

**Key screens**

1. **Sign in / accept invite:** SSO buttons plus email invite acceptance (set name, avatar, timezone)
2. **Members list:** table with avatar, name, email, org role, groups, status, last active; invite button opens the multi-step invite form
3. **Invite members (3 steps):** (1) emails, role; (2) groups and spaces to join; (3) review and send. Also shows pending invites with resend and revoke
4. **Member profile:** details, groups, spaces and roles, with deactivate/reactivate for admins
5. **Groups:** list and detail page with member management
6. **Spaces directory:** card or table view, filters for open/private/archived and "my spaces"
7. **Create space (4 steps):** (1) basics: name, key (auto-suggested, editable), icon, description; (2) visibility; (3) members and groups with space roles; (4) review and create
8. **Space overview:** header with key and icon, description, member summary, recent changes
9. **Space members:** table of users and groups with space roles, add members dialog, remove, and role change
10. **Space settings:** grouped sections (General, Access, Danger zone with archive and delete)
11. **Access requests:** inbox for space admins to approve or decline
12. **Audit log:** filterable table by actor, action and date range

**Quality bar:** keyboard accessible, correct focus handling in dialogs, visible loading and error states on every screen, and no layout shift when data loads.

## 7. Phased build plan

Nine phases, each ending in something demonstrable. Do not move on until the done criteria are met.

### Phase 0: Foundation

- Monorepo, tooling, CI (lint, types, tests), environment config
- Postgres and Redis setup, migration tool, tenant isolation (tenant\_id plus row-level security), seed script (two demo tenants, each with an owner)
- Next.js app with Tailwind and shadcn/ui initialized, theme tokens, light/dark mode
- Fastify app with a health route, error handling, request validation, structured logging
- **Done when:** both apps run locally with one command, CI is green, each seeded tenant has an owner, and a test proves one tenant cannot read another's data

### Phase 1: Authentication and app shell

- Google/Microsoft SSO restricted to the tenant's verified domain, tenant resolved from the subdomain, and invite-link acceptance
- Secure sessions, logout, route protection, and a current-user endpoint
- App shell: grouped sidebar, top bar, breadcrumbs, user menu, command palette (navigation only), empty home page
- Permission module skeleton (`can()`) with unit tests for org roles
- **Done when:** an invited user can sign in, and the shell renders correctly on desktop, tablet and mobile

### Phase 2: Members and invitations

- Members table (search, filter, sort, pagination, row actions)
- Multi-step invite form, SendGrid invite email via BullMQ, resend and revoke, expiry
- Member profile page, edit own profile, change org role, deactivate and reactivate
- Audit log entries for every action in this phase
- **Done when:** an admin can invite a person, they accept and appear in the list, and an admin can deactivate them and block their login

### Phase 3: Groups

- Groups list and detail page, create/edit/delete, add and remove members
- Group picker component reused in later forms
- **Done when:** an admin can build teams and see each member's groups on the member profile

### Phase 4: Spaces

- Spaces directory with open/private/archived filters, starred and recent items in the sidebar
- Multi-step create space form, space overview, settings (general, access, danger zone), archive and restore
- Unique space keys, creator becomes space admin
- **Done when:** any member can create a space, and admins can edit and archive it

### Phase 5: Space access

- Space members tab: add users or groups with roles, change role, remove, last-admin protection
- Effective role calculation from direct and group membership
- Open vs private visibility, request access flow and approval inbox
- Per-space and org-wide audit log views
- **Done when:** a private space is invisible to non-members, group-based access works, and permission tests cover every cell of the matrix in section 5

### Phase 6: Hardening and polish

- Accessibility and keyboard pass, empty/loading/error states on every screen
- Playwright end-to-end tests for the main flows (invite, create space, assign members, request access)
- Performance check on large member lists, seed data for demos, README and deployment notes
- **Done when:** the end-to-end suite passes in CI and the demo flow runs without errors

### Phase 7: Daily check-in/check-out

- Work status data model, tenant work settings (work days, hours, timezone, sites), holiday calendar
- Check-in/out control in the top bar, "My day" page, weekly plan, team status board
- Auto-close of forgotten check-outs, edit with reason and audit trail, admin CSV export
- Details in section 11
- **Done when:** a member can check in from the top bar, teammates see their status within seconds, and a manager sees the team's history

### Phase 8: CRM

- Companies, contacts, leads, deals with a configurable pipeline, activities and notes
- Pipeline board, record detail pages with a timeline, CSV import and export, CRM dashboard
- Details in section 12
- **Done when:** a user can capture a lead, convert it to a contact and deal, move the deal across stages, and log activities, all isolated per tenant

### Phase 9: Tenant onboarding and platform admin

- Self-serve or admin-created tenant provisioning with subdomain, verified email domain and first owner
- Per-tenant branding (name, logo, accent color) and settings
- Platform super-admin console (separate from tenant admins): list tenants, suspend, view usage, impersonate with audit
- Plan and feature-flag tables and limit checks (seats, storage) wired in, with no payment integration
- **Done when:** a new tenant can be created end to end, isolated from the others, and a suspended tenant cannot sign in

## 8. API outline

REST under `/api/v1`, JSON, cookie sessions. Every route validates input with zod and checks permissions through `can()`.

| Resource        | Endpoints                                                                                                                                              | Phase  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Auth            | `GET /auth/sso/:provider`, `POST /auth/invite/accept`, `POST /auth/logout`, `GET /me`, `PATCH /me`                                                     | 1      |
| Members         | `GET /members`, `GET /members/:id`, `PATCH /members/:id` (role, profile), `POST /members/:id/deactivate`, `POST /members/:id/reactivate`               | 2      |
| Invitations     | `GET /invitations`, `POST /invitations` (bulk), `POST /invitations/:id/resend`, `DELETE /invitations/:id`                                              | 2      |
| Groups          | `GET /groups`, `POST /groups`, `GET /groups/:id`, `PATCH /groups/:id`, `DELETE /groups/:id`, `PUT /groups/:id/members`                                 | 3      |
| Spaces          | `GET /spaces`, `POST /spaces`, `GET /spaces/:id`, `PATCH /spaces/:id`, `POST /spaces/:id/archive`, `POST /spaces/:id/restore`, `POST /spaces/:id/star` | 4      |
| Space members   | `GET /spaces/:id/members`, `POST /spaces/:id/members`, `PATCH /spaces/:id/members/:memberId`, `DELETE /spaces/:id/members/:memberId`                   | 5      |
| Access requests | `POST /spaces/:id/access-requests`, `GET /access-requests`, `POST /access-requests/:id/approve`, `POST /access-requests/:id/decline`                   | 5      |
| Audit           | `GET /audit-logs` (filters: actor, action, target, date range)                                                                                         | 2 to 5 |

List endpoints use cursor or page-based pagination, `q` for search, and consistent error shapes (`code`, `message`, `fields`).

## 9. Definition of done and open decisions

Every phase is done only when all of the following hold.

- Lint, type-check and tests pass in CI
- New endpoints have permission tests (allowed and denied cases)
- New screens have loading, empty and error states, and work with the keyboard
- Migrations are reversible and seeded demo data still works
- `CHANGELOG.md` and `DECISIONS.md` are updated

**Open decisions to settle before Phase 0**

- [ ] ORM choice: Drizzle or Prisma
- [ ] Hosting and deployment target (existing VM setup or a managed platform)
- [ ] Email sender domain and SendGrid account to use for invites
- [ ] Identity provider: Google Workspace, Microsoft, or both
- [ ] Branding: product name, logo, and primary color for the theme
- [ ] Who can create spaces: any member (current default) or admins only

* [ ] Tenant URL scheme: subdomain per tenant (default) or a path prefix
* [ ] Tenant data isolation: shared schema with row-level security (default) or a separate schema per tenant
* [ ] CRM scope: is it for our own clients and sales pipeline (assumed), and should deals link to spaces?
* [ ] Check-in/out policy: is it team visibility only (assumed), or an attendance record HR relies on?

## 10. Multi-tenancy

Every company that uses the platform is a tenant. Tenant isolation is a Phase 0 concern, because retrofitting it later is the most expensive mistake in a SaaS build.

**Approach:** one database, one shared schema, `org_id` on every business table, enforced by PostgreSQL row-level security (RLS). This is the simplest model to operate and scales well past our first customers. Moving a large tenant to its own database later stays possible.

| Concern           | Rule                                                                                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant resolution | From the subdomain (`acme.ourapp.com`), falling back to the session's active tenant. A request with no resolvable tenant is rejected                                                                        |
| Data access       | Every query runs inside a tenant context. The API sets `app.current_org` per request, and RLS policies filter on `org_id`. Application code never relies on RLS alone: repositories also filter by `org_id` |
| Identity          | `users` are global (one person, one email). `memberships` link a user to each tenant they belong to, with a role per tenant. A tenant switcher appears when a user has more than one                        |
| Uniqueness        | Constraints that look tenant-wide always include `org_id` (space key, group name, CRM company name)                                                                                                         |
| Auth              | SSO and invites are checked against the tenant's verified email domain. Invite tokens are bound to one tenant                                                                                               |
| Background jobs   | Every BullMQ job carries `org_id` and re-establishes tenant context. Redis keys are prefixed `org:{id}:`                                                                                                    |
| Files             | Storage paths start with the tenant id. Signed URLs are short-lived and checked against the tenant                                                                                                          |
| Audit             | `audit_logs` are per tenant. A separate platform audit log records super-admin actions                                                                                                                      |
| Settings          | `tenant_settings` hold timezone, work week, branding, and enabled modules (members/spaces, check-in, CRM)                                                                                                   |
| Plans             | `plans` and `tenant_plans` tables with limits (seats, storage) and feature flags. Enforce limits in the API, but build no payment flow yet                                                                  |
| Super admin       | A separate platform role and console, never mixed with tenant owner/admin roles. Impersonation is time-boxed and audited                                                                                    |
| Lifecycle         | Tenants can be active, suspended or deleted. Provide a per-tenant data export and a deletion job                                                                                                            |

**Mandatory tests**

- Cross-tenant tests for every module: create data in tenant A, then try to read, update and delete it as tenant B through the API and confirm every attempt fails
- Direct database test that RLS blocks a query run in the wrong tenant context
- Search, autocomplete and pickers (people, groups, companies) return only the current tenant's records

**Naming:** the existing `organizations` table is the tenant table, and `org_id` is the tenant key everywhere in this brief.

## 11. Check-in/check-out and daily status

This module gives teams visibility into who is working where and when. It is not a payroll or formal attendance system. Presence (online/away in chat) is a separate, later feature and is out of scope here.

**Behavior**

- **Check-in:** one click from the top bar records the time and the day's work location. Location types: Onsite (with a site), Remote, Offsite (client site, field work, travel), On leave (set manually, no approval flow), Holiday (set from the tenant calendar)
- **Check-out:** one click, with an optional note on what was done
- **Weekly plan:** members can set planned locations ahead ("remote Thursday, onsite Friday"). The check-in confirms or overrides the plan
- **Forgotten check-out:** auto-close at the tenant's end-of-day time, flagged as auto-closed. Members can request a correction and edit with a reason
- **Visibility:** teammates see status only (location, checked in or out, on leave). Exact check-in times are visible to the member, their manager and admins, to avoid a surveillance feel
- **Tenant settings:** work days and hours, timezone default, sites, auto-close time, whether notes are required
- **Timezones:** a "day" is always computed in the member's own timezone, and stored as a local date

**Data model** (all tables carry `org_id`)

| Table            | Key fields                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| sites            | id, name, address                                                                                                      |
| work\_days       | id, user\_id, date, planned\_location, location\_type, site\_id, checkin\_at, checkout\_at, note, auto\_closed, source |
| work\_day\_edits | id, work\_day\_id, edited\_by, old\_values, new\_values, reason, edited\_at                                            |
| holidays         | id, date, name                                                                                                         |
| manager links    | `reports_to` on memberships, used for manager visibility                                                               |

**API** (under `/api/v1`)

- `POST /checkin`, `POST /checkout`, `GET /me/today`, `PUT /me/plan` (week)
- `GET /team/status` (current status board, filterable by group or space), `GET /work-days` (history, role-scoped)
- `PATCH /work-days/:id` (correction with reason), `GET /work-days/export` (CSV, admin)
- `GET/PUT /settings/work`, `CRUD /sites`, `CRUD /holidays`

**UI**

- Top bar **check-in control**: a button showing the current state (Check in / Checked in 09:12 / Checked out) that opens a popover to choose location and add a note
- **My day** page: today's status, weekly plan editor (week grid with location chips), recent history
- **Team board:** grouped by location (Onsite, Remote, Offsite, On leave) with avatars, filterable by group and space; also available as a compact widget on Home
- **Attendance** admin page (sidebar group _Workspace_): table with date range, member, location, hours, flags for auto-closed and edited days, CSV export
- **Settings > Work:** grouped cards for hours, sites, holidays and auto-close rules

## 12. CRM module

A lightweight CRM for tracking clients and sales: companies, contacts, leads, deals and the activity around them. Keep it simple and fast, not a Salesforce clone. This section assumes the CRM is for the tenant's own clients and pipeline (see open decisions).

**Features**

- **Companies and contacts:** profiles with owner, tags, linked contacts, and a timeline of notes and activities
- **Leads:** capture manually or by CSV import, with source and status (New, Contacted, Qualified, Unqualified). Convert a lead into a contact, company and deal in one step
- **Deals and pipeline:** per-tenant configurable pipeline stages (defaults: Prospecting, Qualified, Proposal, Negotiation, Won, Lost), deal value and currency, expected close date, owner. Drag-and-drop board plus a table view
- **Activities:** calls, meetings, emails (logged manually) and tasks with due dates and assignees. An "Upcoming and overdue" list on the CRM dashboard
- **Notes** with @mentions of members
- **Search, saved views and filters** on every list, with CSV import and export
- **Dashboard:** open deals by stage, deals won this month, leads by source, my overdue activities

**Access:** a module-level CRM role per member: CRM admin (configure pipelines, import, delete), CRM member (create and edit), CRM viewer (read-only). Org owners and admins are CRM admins. By default all CRM users in a tenant see all CRM records. The module can be switched off per tenant in settings.

**Data model** (all tables carry `org_id`)

| Table           | Key fields                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| crm\_companies  | id, name, website, industry, size, owner\_id, tags                                                                |
| crm\_contacts   | id, company\_id, name, email, phone, job\_title, owner\_id, tags                                                  |
| crm\_leads      | id, name, email, company\_name, source, status, owner\_id, converted\_at                                          |
| crm\_pipelines  | id, name, is\_default                                                                                             |
| crm\_stages     | id, pipeline\_id, name, position, probability, is\_won, is\_lost                                                  |
| crm\_deals      | id, pipeline\_id, stage\_id, company\_id, contact\_id, title, value, currency, expected\_close, owner\_id, status |
| crm\_activities | id, type, subject, due\_at, completed\_at, assignee\_id, linked\_type, linked\_id                                 |
| crm\_notes      | id, body, author\_id, linked\_type, linked\_id                                                                    |
| crm\_tags       | id, name, color                                                                                                   |

Deals and companies may later link to a space (a client project). Do not build that link yet, but keep `company_id` clean so it is easy to add.

**API:** standard CRUD under `/api/v1/crm/` for `companies`, `contacts`, `leads`, `deals`, `activities`, `notes`, `pipelines` and `stages`, plus `POST /crm/leads/:id/convert`, `POST /crm/deals/:id/move`, `POST /crm/import/:type`, `GET /crm/export/:type` and `GET /crm/dashboard`.

**UI**

- New sidebar group **CRM** with Dashboard, Leads, Contacts, Companies, Deals, Activities
- **Deals board:** kanban columns per stage with total value in each header, drag-and-drop with optimistic updates, quick-add card, filter bar (owner, tag, close date)
- **Record detail pages:** two-column layout, with fields grouped in cards on the left and a tabbed timeline (Activity, Notes, Deals, Contacts) on the right. Inline-editable fields
- **Lead conversion:** a multi-step dialog (review lead, choose or create company and contact, create deal)
- **Import wizard:** upload, map columns, preview with errors, confirm
- **Pipeline settings:** reorderable stage list in the admin area

## 13. Prompts to give Claude

Paste the kickoff prompt into Claude Code at the repo root, together with this brief saved as `docs/BRIEF.md`. Paste the UI prompt alongside it, or save it as `docs/UI.md` and reference it.

### Kickoff prompt

```markdown
You are the lead engineer building a multi-tenant company platform (Jira/Slack-style) that we will use internally first and sell to other companies later.

Read docs/BRIEF.md fully before doing anything. It defines the scope, tech stack, domain model, roles and permissions, UI requirements, API outline and nine build phases.

Rules:

- Build one phase at a time, in order. Do not start a phase until the previous one meets its done criteria.
- Respect the non-goals. If something is not in the brief, ask before adding it.
- Multi-tenancy is foundational: every business table has org_id, Postgres row-level security is enabled from Phase 0, and every module ships with cross-tenant isolation tests.
- Enforce permissions on the server through a single can(user, action, resource) module. The UI only mirrors it.
- Use shadcn/ui, Tailwind, react-hook-form, zod and TanStack Query/Table. Do not hand-roll components shadcn provides.
- Before writing code for a phase, reply with a short plan: files, migrations, endpoints, screens, and risks. Wait for my approval.
- Work in small commits. Run lint, type-check and tests before saying a task is done. Update docs/CHANGELOG.md and docs/DECISIONS.md as you go.
- When the brief is ambiguous, list the options with a recommendation and ask.

Start now with Phase 0 (Foundation). First, list any open decisions from section 9 that block it, then give me the Phase 0 plan.
```

### UI prompt

```markdown
Build a proper, professional UI in the spirit of Jira and Slack: dense but calm, fast, and consistent. It must look like a product people would pay for, not a template.

Design system

- shadcn/ui on Tailwind with CSS-variable theming. One neutral gray scale plus a single accent color; the accent is a per-tenant setting.
- Font: Inter (or Geist). Base 14px, 13px in dense tables. Clear type scale, medium weight for labels, muted text for secondary info.
- 8px spacing grid, 6 to 8px radius, subtle borders over heavy shadows. Light and dark themes, both polished.
- lucide-react icons only, 16px in navigation and tables.

Layout

- App shell: collapsible grouped sidebar (Workspace, Spaces, CRM, Administration), top bar with breadcrumbs, global Cmd/Ctrl+K command palette, check-in control and user menu.
- Sidebar groups are collapsible, remember their state, and show badges (for example pending access requests). Tenant switcher and logo sit at the top of the sidebar.
- Pages share one header pattern: title, description, primary action on the right, optional tabs below.
- Responsive: sidebar becomes a sheet on mobile, tables scroll horizontally with a sticky first column.

Patterns

- Data tables with search, filter chips, sortable columns, column visibility, pagination, row action menus and bulk selection.
- Multi-step forms with a stepper, per-step validation, a review step, and a clear back/next footer. Group related fields in cards with titles and helper text.
- Kanban board for CRM deals with smooth drag-and-drop, column totals and quick-add.
- Detail pages with a two-column layout: grouped, inline-editable fields on the left and a tabbed timeline on the right.
- People and group pickers with avatars; role badges with consistent colors; status chips for check-in states.

Quality

- Every screen has loading skeletons, empty states with a call to action, and friendly error states.
- Toasts for success, confirmation dialogs for destructive actions, optimistic updates where safe.
- Keyboard accessible, visible focus rings, correct ARIA in dialogs and menus, WCAG AA contrast.
- No layout shift on load. Animations are short (150 to 200ms) and subtle.

Before building screens, create a /design page in the app that shows the shared components (buttons, badges, tables, forms, stepper, empty states) in both themes, and get my approval of it first.
```
