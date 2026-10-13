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

## Open (not blocking)

SendGrid sender domain, product name/logo/accent color, who can create spaces, CRM scope, check-in policy, hosting target.
