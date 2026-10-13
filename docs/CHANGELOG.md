# Changelog

## 2026-10-13 - Phase 0: Foundation

- pnpm monorepo: `apps/web` (Next.js, Tailwind, shadcn/ui, light/dark), `apps/api` (Fastify), `packages/shared`.
- Postgres schema (`organizations`, `users`, `memberships`) with row-level security, plus reversible SQL migrations.
- `withTenant()` helper, restricted `crew_app` DB role, seed script (tenants `acme`, `globex`, one owner each).
- Redis/BullMQ helpers (tenant-prefixed keys, jobs carry `orgId`).
- Dockerfiles, docker-compose (Postgres + Redis; `full` profile adds api + web), Makefile (`make dev`), GitHub Actions CI.
- Tests: direct-DB RLS isolation, API cross-tenant scaffold, seed owners, health and error shape.
