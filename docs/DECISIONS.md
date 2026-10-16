# Decisions

## ADR-001: Drizzle with hand-written reversible SQL migrations

*Superseded by ADR-051 (MongoDB).*

Drizzle gives typed queries and keeps RLS policies as plain SQL. drizzle-kit does not produce down migrations, and the brief requires reversible ones, so migrations are `NNNN_name.up.sql` / `.down.sql` files run by `src/db/migrate.ts`. The Drizzle schema in `src/db/schema.ts` is kept in step by hand.

## ADR-002: Google-only SSO for now

Microsoft is deferred. Auth code uses a `GoogleClient` interface so another provider can be added later.

## ADR-003: Shared schema with Postgres RLS

*Superseded by ADR-051 (MongoDB).*

`org_id` on every business table, RLS enabled and FORCEd, policies on `current_org_id()` (`app.current_org`, set per transaction by `withTenant`). The app connects as `crew_app` (no superuser, no BYPASSRLS); migrations and seeding use the owner role. Repositories also filter by `org_id`.

## ADR-004: `users` is global but RLS-scoped; pre-tenant lookups use SECURITY DEFINER functions

*Superseded by ADR-051 (MongoDB).*

A user is visible only when they have a membership in the current tenant. Sign-in and invite acceptance happen before a tenant context exists, so migration 0002 adds narrow `SECURITY DEFINER` functions (`auth_org_by_slug`, `auth_org_by_id`, `auth_user_by_email`, `auth_invitation_by_hash`, `auth_pending_invitation`, `auth_user_id_by_email`, `auth_user_orgs`). Each takes a specific key and returns the minimum columns; none lists data. They bypass RLS because they are owned by the migration role, so that role must be a superuser or have BYPASSRLS (true for the Docker setup; revisit for a managed Postgres).

## ADR-005: API runs through tsx

`@crew-deck/shared` exports TypeScript source, so the API is started with `tsx` (also in Docker) instead of compiling to `dist`. Revisit if startup time or image size matters.

## ADR-006: Local ports

Host ports are Postgres 5433 and Redis 6380 (`POSTGRES_PORT`, `REDIS_PORT`) because 5432 was already in use on the dev machine.

## ADR-007: Auth methods and sessions (Phase 1)

Methods: Google SSO, email + password (argon2id), and a dev-only login that is not registered when `NODE_ENV=production`. Added `users.password_hash` (not in the brief's table list; approved). Sessions are opaque random ids stored in Redis under `org:{id}:sess:{sha256}`, sent in an httpOnly, SameSite=Lax cookie scoped to the tenant host. The user's status and membership are re-checked on every request, so deactivation takes effect immediately. State-changing requests carrying an Origin header must match the host. Sign-in attempts are rate limited per client + email.

## ADR-008: Same-origin API via Next rewrite

The browser only talks to its tenant origin (`acme.localhost:3000`); Next proxies `/api` to the API and passes `x-forwarded-host`, which is how the API resolves the tenant. This keeps cookies host-scoped per tenant and avoids CORS. The API trusts that header, which is safe because a session lookup is keyed by tenant, so forging the header only yields "unauthenticated". In production, keep the API on a private network and set `TRUST_PROXY`.

## ADR-009: Google redirect via a ticket

Google only allows registered redirect URIs, so the callback runs on the apex host (`WEB_ORIGIN`). It creates the session and redirects to the tenant host with a one-time 60-second ticket, which sets the cookie there. No session id travels in a URL.

## ADR-010: Placeholder routes for later screens

Sidebar items for screens built in later phases route to a shared "Not built yet" page that names the phase, so navigation and the command palette are complete without building out-of-phase features.

## ADR-011: Brevo instead of SendGrid for email

The brief named SendGrid; the owner chose Brevo for now. Invite emails go through Brevo's transactional API (POST https://api.brevo.com/v3/smtp/email, api-key header) behind a small `EmailSender` interface, sent from a BullMQ job that carries org_id. Env var names: BREVO_API_KEY, EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME. With no key set, the sender logs the invite link instead of sending, so local development works. Switching provider later means swapping one implementation.

## ADR-012: Deactivation is per workspace (memberships.status)

The brief puts `status` on `users`, but a user is a global identity that can belong to several workspaces, so deactivating them in one workspace must not lock them out of another. Migration 0003 adds `memberships.status` ('active' | 'deactivated') and `deactivated_at`. The effective status (membership wins over `users.status`) is used for sign-in, the session check, member lists and the workspace switcher. Sessions need no explicit kill: every request re-checks status, so deactivation takes effect on the next request. Editing a person's name or job title changes the global user row, so it is visible in every workspace they belong to.

## ADR-013: Audit log is append-only

`audit_logs` entries are written in the same transaction as the change they describe. The application role has SELECT and INSERT only (UPDATE, DELETE and TRUNCATE are revoked explicitly, because default privileges would otherwise grant them). Phase 2 records: invitation.created / resent / revoked / accepted, member.role_changed / profile_updated / deactivated / reactivated.

## ADR-014: Member directory visible to all members

`GET /members` and `GET /members/:id` are open to every signed-in member (a People directory). Non-admins only see active people and never see last-login times. Invitations, role changes, deactivation and the audit log are admin-only. The brief's matrix does not list the directory, so this is a decision to confirm.

## ADR-015: TanStack Table v8

`@tanstack/react-table` 9.x changed the API; the project is pinned to 8.21.3, which matches the shadcn data-table pattern. Revisit when v9 stabilises.

## ADR-016: Tests run on their own database

API tests create and use `<db>_test` (derived from DATABASE_URL), so they never pollute the development database. The global setup creates the database if missing, mirrors the app-role default privileges, migrates and seeds. This needs the admin role to have CREATEDB (true for the Docker setup and the CI service).

## ADR-017: Group tables carry org_id and composite foreign keys

`group_members` has `org_id` (the brief lists only group_id and user_id) so row-level security applies directly. Composite foreign keys `(group_id, org_id)` and `(org_id, user_id)` make it impossible to link a group and a person from different workspaces, even through a bug or direct SQL. Invitations gained `group_ids` so the groups chosen at invite time are applied on acceptance (groups deleted in the meantime are skipped).

## ADR-018: Spaces

- **Visibility and roles.** Org owners and admins see every space. Everyone else sees open spaces plus private ones where they hold a role. The caller's effective role is the highest of their direct membership and every group they belong to (admin > member > viewer), computed in one SQL expression shared by list and detail queries. Hidden spaces return 404, never 403.
- **Keys.** Unique per workspace, 2 to 10 characters, stored upper case, immutable, and never reused: deleting a space is a soft delete (`deleted_at`), so the unique constraint still covers it. "NEW" is reserved because it is the create page's URL.
- **Added beyond the brief's table list:** `space_members.org_id` and `spaces.deleted_at` (as above), and a `space_stars` table, because `POST /spaces/:id/star` needs somewhere to store stars. "Recent" spaces are kept in the browser only.
- **Permissions.** Creating a space: any member (open decision still pending). Editing, archiving and restoring: space admins and org admins. Deleting: org owners and admins only (the brief's matrix does not cover delete), and the caller must type the key. Archived spaces are read-only until restored.
- **By id or key.** `/spaces/:id` accepts either, so the web app can use readable URLs (`/spaces/ENG`).
- **Members tab is read-only in Phase 4;** adding, removing and changing roles belong to Phase 5.

## ADR-019: Searchable pickers query the server

The people and group pickers search on the server (debounced) instead of loading a workspace into the browser. They never return another workspace's records; this is covered by tests.

## ADR-020: Access requests keep private spaces hidden

A private space stays invisible to non-members, including its name, so there is no "locked card" in the directory. People ask by typing the space key an admin shared. `POST /spaces/:id/access-requests` returns the same answer whether the space exists, is open, is archived, or the caller already has access, and it is rate limited per session, so keys cannot be probed. Requesters see only the key they asked for, never the space name. Space admins and workspace owners/admins review and approve (choosing the role); requests do not expire; requesters can cancel. One pending request per person per space is enforced by a partial unique index.

## ADR-021: Last-admin rule

A space must keep at least one admin. Changing or removing a space-admin row is refused when no other admin would remain. A group row counts as an admin only while the group has at least one active person, and a person row only while their membership is active. Indirect changes are not blocked (editing a group's members, deleting a group, deactivating a person), because they happen outside the space; workspace admins can always repair a space from its Members tab.

## ADR-022: Hermetic test database

The test database is dropped and recreated at the start of every API test run, so results never depend on earlier runs.

## ADR-023: Accessibility is tested, not assumed

Every main screen is scanned with axe (WCAG 2.1 A and AA) in light and dark themes, plus open dialogs, menus and the command palette, and keyboard behaviour is tested (skip link, focus visibility, focus trap and return, menus, wizard). Findings fixed in this phase: the primary blue was darkened to reach 4.5:1 contrast with white text; Radix tab triggers no longer point `aria-controls` at unmounted panels; the command palette no longer puts separators inside a listbox; icon and visibility pickers are toggle buttons (`aria-pressed`) rather than radios without arrow-key support. One rule is switched off, only while a modal menu or dialog is open: `aria-hidden-focus`, because Radix hides the page behind the modal and traps focus inside it, which axe cannot see.

## ADR-024: Hardening choices

- A 401 from the API in the browser sends the person to sign in (session ended or account deactivated).
- Route error boundaries keep the sidebar; a global boundary is the last resort; not-found pages exist inside and outside the shell.
- Both apps set security headers. API responses are `no-store`. The web CSP only restricts framing, base and form targets; a script-source policy needs per-request nonces and is deferred to deployment work.
- Large lists: member, group and space lists are server-paged. A group's member list is returned whole by the API (2,000 members measured at about 30 ms) and paged in the browser.
- No extra database indexes were added: at 5,000 people and 1,500 spaces every list answers in at most 130 ms.

## ADR-025: End-to-end tests run the dev servers in CI

The suite uses the dev-only sign-in box and starts the servers through Playwright's webServer option, so CI runs the same commands as a developer. Production mode (no dev login) is covered separately by the containerised smoke test in the deployment notes.

## ADR-026: Check-in is a team status board, not an attendance record

Decided with the owner (the brief left it open): check-in gives teams visibility of who is working where. It is not a payroll or formal attendance system, so the export is called a "status log". Corrections are still audited and kept (a reason is mandatory), so the trail is honest, but nothing here promises legal evidentiary value. If HR later relies on it, that needs stricter edit rules and retention.

## ADR-027: One check-in per person per day, in the person's own timezone

`work_days` has one row per person per local date (unique on org, user, date). A "day" is the person's own calendar date, computed with Intl, never UTC. Re-checking in after checking out the same day is refused; people correct the day instead. An open check-in from an earlier day can still be checked out (overnight work). Daylight-saving changes are handled by the timezone maths and covered by unit tests.

## ADR-028: Who sees what

Teammates see status only (location, in/out, leave). Exact times and the auto-closed flag go to the person, their manager (`memberships.reports_to`) and workspace admins. Managers are set by admins only, with loop protection. Days of people you may not manage look like they do not exist (404), not forbidden.

## ADR-029: Corrections instead of approval flows

People edit their own days directly with a mandatory reason; managers and admins can correct their reports' (admins anyone's). Every correction writes a `work_day_edits` row (old and new values, append-only for the application role) and an audit entry, and the day is flagged "Edited". `POST /work-days` was added (beyond the brief's endpoint list) so a day with no record at all, such as a forgotten check-in, can be added with the same rules. Leave is set by the person through the plan with no approval flow, as in the brief.

## ADR-030: Auto-close runs as per-workspace jobs

A repeatable job ticks every minute. The tick belongs to no tenant, so it only lists workspace ids through a narrow SECURITY DEFINER function (`auth_list_org_ids`) and queues one job per workspace; each of those jobs carries `org_id` and runs inside that tenant's context. Job ids include the minute so two API instances cannot double-queue. An open check-in is closed at the auto-close time (default 20:00) in the person's own timezone, stamped at that time, or at the check-in itself for someone who checked in after it, and flagged auto-closed.

## ADR-031: CSV export is spreadsheet-safe

Cells starting with = + - @ tab or CR are prefixed with an apostrophe so a note like `=HYPERLINK(...)` cannot run as a formula. The file carries a UTF-8 byte-order mark so Excel reads it correctly.

## ADR-032: CRM scope and roles

Decided with the owner: a focused sales CRM, not a marketing suite. Leads, contacts, companies, deals in configurable pipelines, activities (call, meeting, email, task), notes with mentions, tags, CSV import and export, and a dashboard. It is a module a workspace can switch off (`tenant_settings.enabled_modules` contains `crm`); when off, every CRM endpoint answers 404 `module_disabled` and the UI hides it. CRM access is its own role per member (`memberships.crm_role`: none, viewer, member, admin; new members default to member). Viewers read, members create and edit, CRM admins also delete, import, export and configure pipelines. Workspace owners and admins always act as CRM admins. Everything goes through `can()` (`crm.view`, `crm.edit`, `crm.admin`).

## ADR-033: Lead conversion is one transaction

Converting a lead can create a company, a contact and a deal, or link an existing company. It runs in one tenant transaction, so a failure part-way (for example a company name clash) leaves nothing behind. The lead keeps links to what it became and cannot be converted twice (409). Records are soft-deleted so history and links never dangle; a company with open deals cannot be deleted.

## ADR-034: Deals on a board with fractional positions

Deals have a stage and a floating point `position`. Dropping a card between two others gives it the midpoint, so one move writes one row. Moving into a won or lost stage sets the status and close time; moving back out reopens it. Money is `numeric(14,2)` with a currency per deal and is never added across currencies: column and dashboard totals are shown per currency. Cross-tenant links are impossible at the database level through composite foreign keys (`(x_id, org_id)`).

## ADR-035: Imports are all-or-nothing with a dry run

A CSV import maps columns to fields, is checked first (dry run), and is rejected as a whole if any row is invalid, with row numbers and reasons, so people never end up with a half-imported file. Up to 5,000 rows per file. Exports are spreadsheet-safe like ADR-031. Import and export are CRM-admin actions and are audited.

## ADR-036: Accessible drag and drop

The board uses dnd-kit with a dedicated drag handle button (so cards do not nest interactive elements), the keyboard sensor, and screen reader announcements that name the card and the stage. Every card also has a menu with "Move to stage", which works for anyone who prefers not to drag. Moves are optimistic and roll back with a message if the server refuses.

## ADR-037: Plans are data; limits and features are checked on the server

Plans live in a global `plans` table (limits as numbers, features as keys that match docs/FEATURES.md). A workspace points at a plan; a platform admin can add per-workspace limit overrides (a number replaces the limit, null lifts it). One module (`plans/index.ts`) resolves the effective plan and exposes `assertWithinLimit` and `assertFeature`, which answer 402 `plan_limit` or `feature_locked`. Every route that creates something limited or opens a gated feature calls it; the UI only mirrors it. A workspace with no plan is internal and unlimited (everything that existed before plans). Limits are soft: they stop you adding more, but nothing is ever deleted, hidden or changed by a limit or a downgrade. Seats count active members plus invitations still waiting, so invitations cannot dodge the limit. The audit log hides entries older than the plan's window but keeps them. Prices are display-only; there is no billing.

## ADR-038: Trials end by the clock, not by a job

A sign-up gets a Business trial (14 days by default, a platform setting). `loadPlan` treats a trial whose end time has passed as Free immediately, so nobody keeps paid features because a background job was late. An hourly job (`plans/jobs.ts`) then stores the downgrade and audits it once per workspace; it is safe to run on every instance because only changed rows are returned.

## ADR-039: Self-serve sign-up proves the email first and creates everything in one transaction

`POST /signup` only stores a hashed, 24-hour, single-use token and emails a link; nothing exists until the link is opened. Opening it runs `provisionWorkspace`: consume the token, create the workspace, its settings, the owner and the trial in one transaction, so a failure never burns the token or leaves half a workspace. People with an existing account keep their password. Free email providers (gmail and similar) are allowed by default and cannot lock invitations to their domain; a platform setting can block them at sign-up. Sign-up is rate limited per client and per email address, addresses are checked against reserved names, and the endpoints exist only on the bare domain. The session reaches the new workspace's own address through the existing one-time ticket hand-off.

## ADR-040: The platform console is separate from workspaces, and tenants cannot touch platform data

Platform admins are a separate table with their own session cookie and Redis namespace, reachable only on the bare domain (404 on a workspace address). The application database role has no direct access to `platform_admins`, `platform_settings`, `signup_requests` or `platform_audit_logs`, and cannot update a workspace's status, plan or limits (column-level grants); everything cross-workspace goes through narrow SECURITY DEFINER functions, the same pattern as sign-in. A suspended workspace is refused at the tenant gate, so sign-in, invitations and already-open sessions all stop at once, and its data is kept. Impersonation opens a workspace as its owner for 30 minutes without extension, is read-only (any non-GET request is refused), shows a banner, and is recorded both in that workspace's audit log and in the platform log.

## ADR-060: Guided flows keep their step in the URL

Multi-step signed-out flows (sign-up, verify, accept invitation) use one hook, `useWizard`. The current step is the `?step=` query parameter, so the browser's Back and Forward buttons move between steps and a refresh stays put. Answers and the furthest step reached are kept in sessionStorage (sign-up only; verify and invitations keep them in memory because they sit beside one-time secrets). Typing a later step into the address bar is redirected to the furthest step reached, so questions cannot be skipped. Focus moves to the new step's heading so screen readers announce it. The photo panel is decorative (empty alt) with a dark gradient so its text keeps its contrast; photos are served from the repo, not hotlinked.

## ADR-041: Attachments live on local disk behind a storage adapter

Attachments are stored through a `StorageDriver` interface (put, get, delete, signed URL). The first driver writes to a directory on the VM outside the web root (`STORAGE_DIR`); an S3-compatible driver (`STORAGE_DRIVER=s3`, built in W8) replaces it without API changes. Keys start with the tenant id (`{org_id}/{space_id}/{item_id}/{uuid}-{name}`), downloads use short-lived signed URLs that are checked against tenant and space access, and size is limited per plan (`max_attachment_mb`, `storage_mb`). Status: built (W3); S3 driver built (W8).

## ADR-042: Rich text is Tiptap, stored as JSON

Work item descriptions and comments use Tiptap and are stored as ProseMirror JSON, never HTML. A plain-text projection is kept for search. Status: planned (W3).

## ADR-043: Members delete only the items they reported

Space admins (and org owners and admins) can delete any item; members only items they reported; viewers none. Deleting is a soft delete and history is never hard-deleted. Status: planned (W1).

## ADR-044: Kanban spaces stay continuous flow

Sprints exist only in Scrum spaces. Board type is chosen at space creation and can be switched only when no sprint is active. Status: planned (W1, W6).

## ADR-045: Epics are not shown as cards on the board

Epics are reached through the epic filter, the epic swimlane and the Epics page; the board shows stories, tasks and bugs, and subtasks as progress on their parent. Status: planned (W1).

## ADR-046: Estimates are story points only

`work_items.estimate` is a number of story points. Subtask estimates are optional and never double-counted with the parent. Hours may be added later as a separate field. Status: planned (W1).

## ADR-047: Work-item limits and gates follow the plans mechanism

New limit keys `work_items` and `max_attachment_mb`, enforcement of the existing `storage_mb`, and feature keys `scrum_sprints`, `shared_filters` and `burndown_reports` use the ADR-037 mechanism (server-checked, 402 `plan_limit` / `feature_locked`, never deleting data). Proposed split is in `docs/work-items/PRICING-GATES.md`. Kanban boards, comments, links and search are available on every plan. Status: planned (W1 onward).

## ADR-048: Item types are fixed

Epic, story, task, bug and subtask are fixed enums. Hierarchy: epic, then story/task/bug, then subtask; depth is capped at three and enforced by the API. Tenant-defined types are out of scope. Status: planned (W1).

## ADR-049: Live updates use server-sent events

Board and item changes reach other browsers over server-sent events scoped by tenant and space access, with Redis pub/sub fan-out; clients refetch on focus as a fallback. Work items use string ranks from `fractional-indexing` (decided in W2) while CRM deals keep their numeric positions (ADR-034). Status: planned (W2, W7).

## ADR-050: Moving cards: neighbour-based string ranks, one lock per space

A card move sends the target status and its neighbour (`afterItemId` or `beforeItemId`, or neither for the end of the column); the server computes a fractional-indexing string rank between the neighbours and returns the item with its new rank, so a move rewrites one row (work items use string ranks; CRM deals keep their numeric positions, ADR-034). Ranks sort bytewise (`COLLATE "C"`). Creates, moves, bulk changes and edits take the space's counter row lock first, so two people dropping cards into the same gap queue up and each sees the other's committed result: both succeed with distinct, ordered ranks. Every move carries `If-Match` with the item's `updated_at` and is checked inside the UPDATE (412 on a stale write), and a neighbour that left the column is a 422 so the board refreshes. A rank over 40 characters queues a background rebalance of that column (BullMQ, tenant context, one job per column, under the same lock); two neighbours with equal ranks are spread apart on the spot. Dropping into a swimlane cell can change the lane's field (assignee, priority or epic) in the same call, with a confirmation when ownership changes. Bulk changes are one transaction per call, limited to 100 items in one space, and skip (and report) the items the person may not change. On the screen the whole card drags with a mouse or finger, and the handle button gives keyboard users the same drag (Space, arrows, Space) with screen-reader announcements; the drag overlay is rendered in the page body so a transformed layout cannot offset it.

## Open (not blocking)

Brevo sender address/domain (must be verified in Brevo), product name/logo/accent color, who can create spaces, check-in policy, hosting target.

## ADR-051: MongoDB instead of Postgres

The data store moved from Postgres to MongoDB (`mongodb` driver 6, no ODM). Documents keep the old
camelCase column names and a UUID `id` field, so the API's response shapes and the web app did not change;
the Mongo `_id` is never exposed. Dates are `Date`; calendar dates stay `YYYY-MM-DD` strings. Indexes
(`src/db/indexes.ts`) replace the SQL migrations and are created idempotently at startup, by
`pnpm db:migrate` and in test setup. The plan catalogue is upserted the same way (`src/db/reference.ts`).
MongoDB runs as a single-node replica set locally so multi-document transactions are available.

Postgres-only behaviour moved into application code: the trigger that gave every space a board and
statuses (`work/seed.ts`), composite foreign keys (explicit same-tenant and same-space checks), cascades
(explicit deletes in a transaction), `FOR UPDATE` (a write to the space counter document inside the
transaction, so concurrent moves conflict and retry), `ILIKE` (escaped case-insensitive regex) and
`lower(name)` unique indexes (a stored `nameLower` field with a unique index).

## ADR-052: Tenant isolation in the repository layer

With no row-level security, isolation is structural. Route and service code receive a `TenantDb`
(`src/db/client.ts`): each repository adds `orgId` to every filter, stamps it on every insert, refuses an
insert for another tenant, and turns a filter naming another tenant into one that matches nothing.
Users are global; a tenant reads them only through `TenantDb.users(ids)`, which goes through memberships
first. A tenant may change only its own branding (`updateBranding`). The audit log and work-day
corrections are append-only through the tenant scope. Code that must cross tenants (sign-in, the platform
console, background fan-out jobs, seeds and tests) uses the explicit `db.global` scope, which keeps those
call sites easy to find. `test/tenant-isolation.test.ts` checks every tenant collection.

## ADR-053: A person belongs to many workspaces, each with many spaces

The model was already user > workspaces (organizations, via memberships) > spaces; it is now visible in
the product. A signed-in person can create another workspace (`POST /workspaces`, they become its owner,
their account is reused, at most 10 owned workspaces) and sees all of theirs at `/my-workspaces` and in the
switcher. Workspaces stay on their own subdomains and sessions stay per workspace address; creating a
workspace hands the session over with the same one-time ticket sign-up uses.

## ADR-054: Workspace types and templates

Sign-up (and creating another workspace) asks "What kind of work do you do?" (15 types, from software to
construction) and "How does your team plan to use it?" (usage options). Both are stored on the organization
(`workType`, `usage`). The type picks a template in `packages/shared/src/workspace.ts`: the modules to switch
on (check-in is on for everyone, CRM for sales, marketing and customer service, plus whatever the chosen
usage implies) and the columns new spaces start with. Usage options that are not built are flagged
`planned`, shown as *Coming soon*, and tracked in docs/MISSING-FEATURES.md. Changing the type later
(`PUT /settings/workspace`) only adds modules, never removes them, so no data is hidden.

## ADR-055: Workspace vocabulary, starter content and switching without signing in again

- **Vocabulary is presentation only.** Each template names its work item (`itemNoun`, for example "job",
  "ticket", "case") and may rename item types (`typeLabels`, for example a construction task is a "Job"
  and a bug a "Defect"). `vocabularyFor()` in `packages/shared/src/workspace.ts` resolves them, and the web
  app reads them through `useVocabulary()`. Type pickers offer the template's `itemTypes` (subtasks always),
  but the API keeps accepting all five types, so changing the kind of work later never strands items.
  Software, product, data science and "other" keep "work item".
- **Starter content.** When a workspace of a known kind is created by someone who already has an account
  (sign-up, "Create a workspace"), the same transaction creates the template's first space (owner as space
  admin, the template's columns, its labels). A workspace created by the platform waits for its owner and
  starts empty.
- **Switching.** Sessions stay per workspace address. `POST /workspaces/:slug/open` checks the person is an
  active member of an active workspace, creates a session there and returns the one-time hand-over link
  sign-up already uses. Workspaces you are not in look like they do not exist; impersonated sessions cannot
  switch.

## ADR-056: Work item depth on MongoDB (W3)

- **Collections, not migrations.** Comments, links, watchers, activity and attachments are tenant collections
  scoped by the repository layer like everything else. `activity_events` is append-only (the repository
  refuses updates and deletes, like the audit log). Watchers have a composite key (item, user) and are added
  with upserts, because a duplicate-key error inside a MongoDB transaction aborts the whole transaction.
- **Rich text is rebuilt, never trusted.** The browser sends Tiptap JSON; `sanitizeDoc` rebuilds it from an
  allow-list of nodes, marks and attributes, keeps only http, https and mailto links, and caps size and depth.
  Mentions must name people who can open the space. Plain `description` still works for older clients.
- **Activity stores snapshots.** Each event keeps display values (a status name, a person's name), so later
  renames do not rewrite history. Field changes are found by comparing the item before and after a change.
- **Links may cross spaces** inside a workspace. Both ends must be visible to create one; lists leave out ends
  the viewer cannot open; either end can remove a link if the caller can change that end.
- **Files.** A `StorageDriver` interface with a local-disk driver. Keys are made of ids only; the cleaned name
  lives in the database, so names cannot steer paths. Links last 15 minutes and are signed with
  `STORAGE_SIGNING_SECRET` over the attachment id, the workspace id and the expiry; the workspace comes from the
  address the link is opened on, so a link never works in another workspace. Only real PNG, JPEG, GIF and WebP
  (judged by their first bytes) show inline; everything else downloads as `application/octet-stream`, and
  programs and scripts are refused. Plan limits `max_attachment_mb` and `storage_mb` are enforced while the
  upload streams.
- **Transfer** gives the item (and its subtasks) new keys in the target space, maps statuses by name and then by
  kind, keeps labels with the same name, drops assignees who cannot open the target, and keeps comments, links,
  attachments and history. A subtask cannot move alone.

## ADR-057: Search, saved filters and notifications on MongoDB (W4, W5)

- **Search** reads only from the spaces the caller can open: the visible space ids go into the query
  (`spaceId: { $in: ... }`), so nothing is filtered after the fact. Order: an exact key, then whole words
  from a text index over the title (weight 5) and `searchText` (the description as plain text, kept on
  every write and backfilled at start), then titles containing what was typed. A query shaped like a key
  ("ENG-142") skips the word index, which would otherwise split it into "eng" and "142".
- **Saved filters** store the filter part of the URL, rebuilt from the known filter keys. Personal ones are
  for everyone; sharing needs `filter.share` (members and up) and the `shared_filters` plan feature.
- **Notifications** are collected while a request changes data and delivered after the transaction commits.
  Delivery never notifies the actor, re-checks that each recipient can still open the space, and follows
  per-type preferences. Emails go into one open batch per person (unique partial index) and are sent by a
  job about five minutes after the first notification. Due-date reminders are idempotent per person, item
  and day through a dedupe key.

## ADR-058: Sprints (W6)

- One running sprint per space is enforced by a unique partial index on `sprints` (`state: 'active'`), so
  two people pressing Start together cannot both succeed. Starting needs dates, work and a space admin.
- Every join and leave is a row in `sprint_items_history`; completion stores a summary (completed, not
  completed, added after the start) for the report. Unfinished work moves to the backlog, a planned sprint
  or a new sprint and its `carryOverCount` grows.
- The burndown reads daily `sprint_snapshots` written hourly in the workspace's timezone (the last run of
  a day wins). Points count stories, tasks and bugs only, so subtasks are never counted twice.
- A Scrum board shows the running sprint only. Switching back to Kanban needs no running sprint and
  returns planned work to the backlog; the sprints are kept.

## ADR-059: Live updates and the route protection test (W7)

- Writers note changes during a request (`liveTouch`; the activity log and `lockSpace` do it for nearly
  every change) through AsyncLocalStorage. After a successful response one message per space is published
  to Redis (`live:org:{org}:space:{space}`), so every API instance hears it; a failed or rolled-back request
  publishes nothing. Messages carry ids and kinds, never content: clients refetch through the normal,
  permission-checked API.
- `GET /spaces/:id/events` checks access on connect and every minute (ending the stream when access is
  lost), sends heartbeats every 20 seconds and caps open streams per person. The browser refreshes the
  space's screens; refetch on focus remains the fallback.
- A test lists every route as it is registered and fails if one has no authentication pre-handler, apart
  from a short list of routes that are public by design.

## ADR-071: Messaging has no row-level security: the repository layer is the boundary, rooms are server-decided

- The brief assumed Postgres row-level security; the platform is on MongoDB (ADR-051), so every messaging collection (`channels`, `channel_members`, `messages`, `message_edits`, `read_cursors`, `user_statuses`) is a tenant collection in `TenantDb`: `orgId` is added to every filter and stamped on every insert.
- A socket never chooses its rooms. The handshake resolves the workspace from the host and the person from the session cookie, then the server joins the personal room, the workspace presence room, the session room and one room per channel the person belongs to. Typing is only accepted for rooms the server put the socket in; every send, edit, delete, read and sync goes through the same services as REST, which re-check membership in the database.
- A channel the caller cannot see answers like one that does not exist (404 over REST, `FORBIDDEN` over the socket), so ids cannot be probed. Org admins can archive, delete and moderate public channels without being members; they cannot read private channels or DMs (open decision "admins read private channels": never, in this build).

## ADR-070: Messages are ordered by a per-channel counter and are idempotent on a client id

- `channels.lastSeq` is bumped with `findOneAndUpdate({$inc})` inside the insert transaction, so `seq` is strictly increasing and gap-free per channel; concurrent senders conflict on the channel document and one retries (a test sends sixteen at once). History is paged by `seq`, never by time.
- A unique partial index on `(orgId, channelId, clientMsgId)` makes a retry safe: the service returns the existing message (HTTP 200 and `duplicate: true`, instead of 201), and a send that races its own retry resolves the duplicate-key error the same way. Someone else cannot claim another person's client id.
- Bodies are the Tiptap JSON subset rebuilt by the same allow-list as work item comments (`sanitizeDoc`), with a plain-text mirror (`bodyText`) for search and previews. Limit 4,000 characters; headings and task lists are not offered in the composer.
- Unread is a cursor (`read_cursors`), never a row per message: unread = messages after the cursor written by someone else, not deleted, not thread replies. Sending moves your own cursor. The cursor only moves forward, except "mark as unread".

## ADR-069: The gateway is a separate service sharing the API's code; presence never touches the database

- `apps/realtime` (Socket.IO with the Redis adapter, WebSocket only so no sticky sessions) imports the API's messaging services through one barrel, `@crew-deck/api/realtime`, so REST and sockets run the same code and `can()`. The API publishes to rooms through `@socket.io/redis-emitter` (persist first, publish second), including moving a person's sockets in or out of a room when membership changes.
- Presence is a Redis hash per person with one field per connection (merged: online if any tab is active, away if all are idle, do-not-disturb overrides) and a 90 second key expiry refreshed by 30 second heartbeats; typing is a throttled signal that is never stored. Presence changes go to a per-workspace room, so they never cross workspaces.
- The per-person and per-workspace message limits are a Lua token bucket in Redis (default 20 per 10 seconds per person). The session is re-validated every five minutes; logout (that session only), deactivation and role changes disconnect sockets at once.
- Open decisions taken as assumed: Socket.IO, a separate gateway, Tiptap JSON, no edit window, responsive web only. Channel creation is open to every member until the admin settings arrive in M5 (`channel.create` is always true in `can()` for now).

## ADR-068: Everyone is put in the default channels lazily, once

- `#general` and `#announcements` are created, and a person joined to them, the first time that person opens Messages (a one-time claim on `memberships.messagingInitAt`). This covers new workspaces, people added by any route (invitation, sign-up, platform) and workspaces that existed before messaging, without touching each of those code paths. Someone who leaves `#general` is not put back; deactivation clears the claim so reactivating them restores the defaults.
- The first person to open Messages becomes the owner of both channels, so an org owner who has not opened Messages yet is not yet a channel owner (they still post in announcements as an org admin).

## ADR-067: Dashboards store the layout, not the data (W13)

- A dashboard is a person's own ordered list of up to twelve tiles (assigned to me, a saved filter, sprint health, release progress, created against resolved). Only the choice is stored (`dashboards`, one row per person); each tile reads the normal endpoints when the page opens, so it always follows the person's current access and plan, and a tile that points at something no longer visible says so instead of failing.
- Pinning a space needs the person to be able to open it. Tiles are reordered with buttons (no drag), which keeps them usable from the keyboard. There are no shared dashboards: a shared saved filter is how a team looks at the same list.

## ADR-066: Time is minutes, the roadmap is epics and releases with dates (W12)

- Planned and remaining time are whole minutes on the item; time worked is a work log (user, day, minutes, note) that cannot be dated in the future. Logging time lowers the remaining time by what was worked unless the person says what is left; editing or deleting a log moves it back. Members log time (and edit their own); space admins can delete any log. Time spent is the sum of an item's logs and is read with the item.
- The roadmap draws epics that have a start or due date, and releases that have a date, on one timeline; progress is children done against children total. Dates are saved through the normal item update (with the version check), so drag, resize, arrow keys and the date dialog all use one path. Start may not be after due. The roadmap is a plan feature (`roadmap`, Team and up); everything else about dates is open on every plan.
- The calendar shows any item with a due date, plus releases, a month at a time (up to two months per request).

## ADR-065: Flow reports are computed from the existing history (W11)

- No new collection: each card's category over time is rebuilt from its creation, the status changes in its activity history (which store the category at the time) and its resolved time. Reports therefore cover a space's whole history without a backfill. A status deleted with a replacement moves cards without an event, and deleted cards leave the history; both are small and accepted.
- Cumulative flow and created against resolved use days in the workspace timezone. Cycle time runs from the first entry into an In progress category (creation if never) to resolution; only cards still in a Done category count. Velocity is the points planned at sprint start against points finished, for the last six completed sprints (Scrum only).
- All four are one request, gated by the `advanced_reports` feature (Business and above); every chart has a data table and a text summary.

## ADR-064: Space documents are a folder library on the same file storage (W14)

- Each space has a document library: nested folders (up to 8 levels, 500 per space, one name per level) and files that belong to the space, not to a work item. Everyone who can open the space can read and download; members add, rename, move and delete what they added; space admins manage everything. Only an admin may delete a folder that has things in it.
- Files use the same storage driver, signed links, size and type checks (`receiveUpload`) and plan limits (`max_attachment_mb`, `storage_mb`) as item attachments, and count toward the workspace's storage. The signed-link route serves both. A file with the same name in a folder is saved as `name (2).ext`.
- Folders and files are plain collections (`space_folders`, `space_files`); a folder move checks that it does not go into itself or past the depth limit. There is no per-folder permission: access is the space's.

## ADR-063: Versions and components are per space; releasing never loses work (W10)

- A version (release) and a component belong to one space. Items carry ids (`fixVersionIds`, `affectsVersionIds`, `componentIds`); names are joined when an item is read, so a rename shows everywhere at once. Deleting a version or component takes it off its items and leaves the items. Moving an item to another space leaves its versions and components behind; duplicating copies them.
- Versions are a plan feature (`releases`, from Team); reading them and components are open on every plan, so work that carries a version does not become unreadable after a downgrade. Members create and edit versions, only space admins release them and manage components.
- Releasing a version moves its unfinished items to another unreleased version or takes them out, in one transaction, and cannot be undone (a released version cannot be reopened, only archived). Release notes list finished work by type; work finished as Won't do or Duplicate is listed as not shipped.
- New work in a component with no assignee goes to the default assignee of the first of its components that has one, if that person can open the space.

## ADR-062: Workflow rules are a list of allowed moves, off by default (W9)

- A space's rules live in its board settings: `restricted` plus, per source status, the statuses it may move to. A source status with no entry is unrestricted, so a new status works straight away and turning the switch on changes nothing until a row is edited. Every way of changing a status (edit, move, bulk move, the sprint-free paths) checks the rules; a bulk move reports each refused item and moves the rest. Transfers and "delete a status with a replacement" are admin or cross-space actions and are not restricted.
- Only people who can manage statuses write the rules. They name statuses of the same space; the API refuses others.
- Resolution (Done, Won't do, Duplicate, Cannot reproduce) belongs to the Done category: it is set (default Done) when an item enters a Done status, can be changed while there, and is cleared when the item leaves.
- "Blocked" is derived, never stored: an item is blocked while a live, not-Done item has a `blocks` link to it. Moving a blocked item forward only asks for confirmation; it is never refused.
- A checklist is part of the item (up to 50 entries, saved as a whole list with the item's version check) and its changes are recorded in the activity history. Templates are per space, up to 20.

## ADR-061: Moved items keep their old keys, backlog order is its own rank, the digest is a send time (W8)

- A transferred item keeps its earlier keys in `keyHistory`; a lookup that finds nothing under a key checks the history and then applies the usual access check to the item's current space. Keys are never reused, so an old key cannot point at two items. The item page replaces the address with the current key.
- Backlog and sprint lists keep a `backlogRank` (fractional string) apart from the board `rank`, which is per status column. Saving an order writes ranks for the whole list; items without one (newly added, or moved between lists, which clears it) follow the ordered ones by board rank.
- An item's `searchText` is its description, its live comments and its attachment names, rebuilt on each change and versioned (`searchVersion`) so start-up rebuilds older items once. Access filtering is unchanged: it happens in the query.
- The daily summary is a per-person flag. It changes only when the person's open email batch is due (08:00 in their timezone) and reuses the batch sender, so a switch needs no new job.
- The S3 driver streams through the API like the local one, so signed links and tenant checks do not change. Deleting an item removes its attachment records in the same transaction and its stored bytes after commit, so storage use drops.
