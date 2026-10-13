# Decisions

## ADR-001: Drizzle with hand-written reversible SQL migrations

Drizzle gives typed queries and keeps RLS policies as plain SQL. drizzle-kit does not produce down migrations, and the brief requires reversible ones, so migrations are `NNNN_name.up.sql` / `.down.sql` files run by `src/db/migrate.ts`. The Drizzle schema in `src/db/schema.ts` is kept in step by hand.

## ADR-002: Google-only SSO for now

Microsoft is deferred. Auth code will use a provider interface so it can be added later.

## ADR-003: Shared schema with Postgres RLS

`org_id` on every business table, RLS enabled and FORCEd, policies on `current_org_id()` (`app.current_org`, set per transaction by `withTenant`). The app connects as `crew_app` (no superuser, no BYPASSRLS); migrations and seeding use the owner role. Repositories also filter by `org_id`.

## ADR-004: `users` is global but RLS-scoped

A user is visible only when they have a membership in the current tenant. Pre-tenant lookups (sign-in by email) cannot go through RLS; Phase 1 must handle that with a narrow `SECURITY DEFINER` function or a dedicated auth path. Decide it in the Phase 1 plan.

## ADR-005: API runs through tsx

`@crew-deck/shared` exports TypeScript source, so the API is started with `tsx` (also in Docker) instead of compiling to `dist`. Revisit if startup time or image size matters.

## ADR-006: Local ports

Host ports are Postgres 5433 and Redis 6380 (`POSTGRES_PORT`, `REDIS_PORT`) because 5432 was already in use on the dev machine.

## Open (not blocking Phase 0)

SendGrid sender domain, product name/logo/accent color, who can create spaces, CRM scope, check-in policy, hosting target.
