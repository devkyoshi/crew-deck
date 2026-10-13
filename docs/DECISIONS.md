# Decisions

## ADR-001: Drizzle with hand-written reversible SQL migrations

Drizzle gives typed queries and keeps RLS policies as plain SQL. drizzle-kit does not produce down migrations, and the brief requires reversible ones, so migrations are `NNNN_name.up.sql` / `.down.sql` files run by `src/db/migrate.ts`. The Drizzle schema in `src/db/schema.ts` is kept in step by hand.

## ADR-002: Google-only SSO for now

Microsoft is deferred. Auth code uses a `GoogleClient` interface so another provider can be added later.

## ADR-003: Shared schema with Postgres RLS

`org_id` on every business table, RLS enabled and FORCEd, policies on `current_org_id()` (`app.current_org`, set per transaction by `withTenant`). The app connects as `crew_app` (no superuser, no BYPASSRLS); migrations and seeding use the owner role. Repositories also filter by `org_id`.

## ADR-004: `users` is global but RLS-scoped; pre-tenant lookups use SECURITY DEFINER functions

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

## Open (not blocking)

Brevo sender address/domain (must be verified in Brevo), product name/logo/accent color, who can create spaces, CRM scope, check-in policy, hosting target.
