# Crew Deck

A multi-tenant company workspace platform in the spirit of Jira and Slack. Companies get an isolated
workspace with members, groups and spaces, per-space access control, invitations, and a full audit
trail. It is built to be used internally first and sold to other companies later.

**Built so far (Phases 0 to 9 of the build brief in [docs/BRIEF.md](docs/BRIEF.md)):**
tenant isolation, sign-in (Google or password), members and invitations, groups, spaces with
open and private visibility, space roles, access requests, audit log, daily check-in/out with a team
status board, a CRM (leads, contacts, companies, deals board, activities, CSV import and export),
self-serve sign-up with email verification, Free / Team / Business plans with limits and feature gates,
workspace branding, a platform admin console (suspend, plans, read-only audited impersonation),
accessibility and hardening. See [docs/FEATURES.md](docs/FEATURES.md) and [docs/PRICING.md](docs/PRICING.md).
**Not built yet:** payments, work items, boards and chat (later modules).

## Quick start

You need Node 22+, pnpm 9, Docker, and GNU Make (Git Bash or WSL on Windows).

```bash
cp .env.example .env     # defaults work for local development
make dev                 # starts Postgres and Redis, migrates, seeds, runs web and api
```

Then open **http://acme.localhost:3000** (any `*.localhost` address works in a browser with no setup).

| Workspace           | Address                      | Sign in as                                                                            | Password           |
| ------------------- | ---------------------------- | ------------------------------------------------------------------------------------- | ------------------ |
| Acme (demo content) | http://acme.localhost:3000   | `owner@acme.test` (owner), `admin@acme.test`, `member@acme.test`, `member2@acme.test` | `dev-password-123` |
| Globex (empty)      | http://globex.localhost:3000 | `owner@globex.test`                                                                   | `dev-password-123` |

The sign-in page also has a **development-only** box that signs you in as any existing person without
a password. It does not exist in production builds. `http://localhost:3000` shows a workspace picker.

The Acme demo workspace has people, four teams, five spaces (open, private and archived), group-based
access, stars, a pending access request, sites, holidays, managers, today's check-in statuses, two
weeks of check-in history and an audit trail, so every screen has something to show.

## Everyday commands

| Command                                       | What it does                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `make dev`                                    | Containers up, migrate, seed (with demo content), run web (:3000) and api (:4000) |
| `make db-reset`                               | Wipe the local database, then migrate and seed again                              |
| `make migrate` / `make rollback`              | Apply pending migrations / revert the latest one                                  |
| `make demo`                                   | Add the demo workspace content to the current database                            |
| `make test`                                   | API tests (they use their own `crewdeck_test` database)                           |
| `make lint` / `make typecheck` / `make build` | Static checks and a production build                                              |
| `pnpm e2e`                                    | Playwright end-to-end suite (starts the servers if they are not running)          |
| `pnpm e2e:ui`                                 | The same, in Playwright's interactive UI                                          |

## What is in the repository

```
apps/api        Fastify API: auth, members, invitations, groups, spaces, access requests, audit
apps/web        Next.js app (App Router), Tailwind, shadcn/ui
packages/shared zod schemas and types shared by both apps
e2e/            Playwright tests (flows, keyboard, accessibility, demo walk-through)
infra/          Postgres role setup used by docker compose
docs/           BRIEF.md (the build brief), DECISIONS.md (architecture decisions), CHANGELOG.md,
                DEPLOYMENT.md
```

## How it works

- **Multi-tenancy.** One database, one schema. Every business table carries `org_id` and is protected
  by Postgres row-level security. The API connects as a restricted role that cannot bypass it, and runs
  every request inside a transaction that sets `app.current_org`. Repositories also filter by `org_id`.
  Composite foreign keys make cross-tenant links impossible. The tenant comes from the subdomain.
- **Permissions** live in one module, `apps/api/src/permissions/can.ts`. Routes call it; the UI only
  mirrors it. A test runs every row of the brief's permission matrix for all six roles through the real API.
- **Check-in** treats a "day" as the person's own local date. Teammates see status only; exact times go to
  the person, their manager and admins. Forgotten check-outs are closed by a background job (see ADR-030).
- **Sessions** are random ids in Redis (httpOnly, SameSite=Lax cookies, Secure in production), scoped to
  the tenant host. Deactivating someone ends their access on their next request.
- **The browser only talks to its own origin.** Next proxies `/api` to the API, so cookies stay per tenant.
- **Everything that changes access is audited**, in the same transaction as the change. The audit table
  is append-only for the application role.

The reasoning behind these choices is written down in [docs/DECISIONS.md](docs/DECISIONS.md).

## Testing

| Layer   | What                                                                                                                                                                                       | How big                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| API     | Permissions (allowed and denied), cross-tenant isolation for every module, rules (last owner, last space admin, unique keys), audit, email, performance with 5,000 people and 1,500 spaces | 234 tests, on a fresh database each run |
| Browser | Real user flows, keyboard-only operation, axe accessibility scans (WCAG 2.1 A and AA, light and dark), and a walk through every screen that fails on any console error or failed request   | 41 tests                                |

CI (`.github/workflows/ci.yml`) runs lint, type-check, the API tests and a production build, and
separately runs the whole Playwright suite against a freshly migrated and seeded database.

## Configuration

All settings are environment variables; see [.env.example](.env.example) for the full list with
comments. The ones you will most likely change:

| Variable                                                 | Purpose                                                                                       |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`               | Enables "Continue with Google" (redirect URI: `<WEB_ORIGIN>/api/v1/auth/sso/google/callback`) |
| `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` | Sends invitation emails. Without a key, invite links are shown to admins to share             |
| `BASE_DOMAIN`, `WEB_ORIGIN`, `TENANT_ORIGIN_TEMPLATE`    | How tenant addresses are built (`<slug>.<BASE_DOMAIN>`)                                       |
| `AUTH_RATE_LIMIT_MAX`                                    | Sign-in attempts per person and client per minute (default 10)                                |

Deploying it somewhere real: see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Known limits

- New workspaces are created by seed or SQL until tenant onboarding (Phase 9) is built.
- Google sign-in and Brevo email are covered by tests with fakes; they have not been exercised against
  the real services because they need credentials.
- Indirect changes can leave a space without an active admin (for example deleting the only admin group).
  Workspace admins can always repair it from the space's Members tab.
