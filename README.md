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
work items on Kanban boards, workspace types ("what kind of work do you do?") with templates, people
who belong to several workspaces, accessibility and hardening. See [docs/FEATURES.md](docs/FEATURES.md)
and [docs/PRICING.md](docs/PRICING.md). **Not built yet:** see [docs/MISSING-FEATURES.md](docs/MISSING-FEATURES.md)
(sprints, comments and attachments, list view, notifications, live updates, payments, chat, and the
type-specific modules such as ticket queues and punch lists).

**Data model:** a person (one account) belongs to any number of **workspaces** (companies), and each
workspace holds any number of **spaces**. Data lives in **MongoDB**.

## Quick start

You need Node 22+, pnpm 9, Docker, and GNU Make (Git Bash or WSL on Windows).

```bash
cp .env.example .env     # defaults work for local development
make dev                 # starts MongoDB and Redis, creates indexes, seeds, runs web and api
```

Then open **http://acme.localhost:3000** (any `*.localhost` address works in a browser with no setup).

Every dev account uses the password **`dev@1234`** (development only; `SEED_PASSWORD` overrides it).
Each workspace is a different kind of business, and each role has its own login, so you can see the
product the way each person sees it.

| Workspace (kind of work)                  | Address                         | Sign in as (role)                                                                                                                                                             |
| ----------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acme Inc (software, Business plan)        | http://acme.localhost:3000      | `owner@acme.test` (owner), `admin@acme.test` (admin), `member@acme.test`, `member2@acme.test` (members), `viewer@acme.test` (member, viewer in ENG, no CRM), `deactivated@acme.test` (cannot sign in), plus demo people such as `priya@acme.test` |
| Globex Corp (sales, internal plan)        | http://globex.localhost:3000    | `owner@globex.test`, `admin@globex.test`, `member@globex.test`, `member2@globex.test`                                                                                         |
| Buildwell Construction (construction, Team) | http://buildwell.localhost:3000 | `owner@buildwell.test`, `foreman@buildwell.test` (admin), `worker@buildwell.test`, `worker2@buildwell.test`, `inspector@buildwell.test`                                      |
| Brightly Marketing (marketing, Free)      | http://brightly.localhost:3000  | `owner@brightly.test`, `member@brightly.test`, `member2@brightly.test`                                                                                                        |
| Suspended Co                              | http://suspended.localhost:3000 | `owner@suspended.test` (shows the suspended screen)                                                                                                                           |
| Several workspaces                        | any of the above                | `multi@crewdeck.test`: member of Acme and Buildwell (viewer in RIVER), admin of Globex, owner of Brightly. Use the workspace switcher.                                        |
| Platform console                          | http://localhost:3000/platform  | `platform@crewdeck.test`                                                                                                                                                      |

The sign-in page also has a **development-only** box that signs you in as any existing person without
a password. It does not exist in production builds. `http://localhost:3000` shows a workspace picker.

The Acme demo workspace has people, four teams, five spaces (open, private and archived), work items,
group-based access, stars, a pending access request, sites, holidays, managers, today's check-in
statuses, two weeks of check-in history, a full CRM and an audit trail. Globex has a CRM and a follow-up
board, Buildwell has job and punch-list boards with construction columns, sites and attendance, and
Brightly has a campaign board, so every screen has something to show.

## Everyday commands

| Command                                       | What it does                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `make dev`                                    | Containers up, migrate, seed (with demo content), run web (:3000) and api (:4000) |
| `make db-reset`                               | Wipe the local database, then create indexes and seed again                       |
| `make migrate`                                | Create the MongoDB indexes and the plan catalogue (idempotent)                    |
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
docs/           BRIEF.md (the build brief), DECISIONS.md (architecture decisions), CHANGELOG.md,
                DEPLOYMENT.md, MISSING-FEATURES.md (what is suggested but not built yet)
```

## How it works

- **Multi-tenancy.** One MongoDB database. Every tenant document carries `orgId`. Route code only ever
  gets a `TenantDb` (`apps/api/src/db/client.ts`), whose repositories add the tenant to every filter and
  stamp it on every insert; a filter naming another tenant matches nothing. Crossing tenants needs the
  explicit `db.global` scope (sign-in, platform console, background jobs, seeds). Links between
  documents are checked by the API, since MongoDB has no foreign keys. The tenant comes from the
  subdomain. Multi-document changes run in MongoDB transactions (a single-node replica set locally).
- **Workspace types.** Sign-up asks what kind of work the team does and how it plans to use the product.
  The answer picks a template (`packages/shared/src/workspace.ts`): modules to switch on, and the columns
  new spaces start with (a construction workspace gets Planned / On site / Inspection / Complete).
- **Permissions** live in one module, `apps/api/src/permissions/can.ts`. Routes call it; the UI only
  mirrors it. A test runs every row of the brief's permission matrix for all six roles through the real API.
- **Check-in** treats a "day" as the person's own local date. Teammates see status only; exact times go to
  the person, their manager and admins. Forgotten check-outs are closed by a background job (see ADR-030).
- **Sessions** are random ids in Redis (httpOnly, SameSite=Lax cookies, Secure in production), scoped to
  the tenant host. Deactivating someone ends their access on their next request.
- **The browser only talks to its own origin.** Next proxies `/api` to the API, so cookies stay per tenant.
- **Everything that changes access is audited**, in the same transaction as the change. The audit log
  is append-only through the tenant scope.

The reasoning behind these choices is written down in [docs/DECISIONS.md](docs/DECISIONS.md).

## Testing

| Layer   | What                                                                                                                                                                                       | How big                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| API     | Permissions (allowed and denied), cross-tenant isolation for every module and collection, rules (last owner, last space admin, unique keys), audit, email, workspace types, multi-workspace, every dev login, performance with 5,000 people and 1,500 spaces | 426 tests, on a fresh database each run |
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

- MongoDB has no foreign keys or check constraints. Integrity between documents (same-tenant links,
  valid status for an item, times in order) is enforced by the API and covered by tests, not by the
  database. Unique indexes still guarantee keys, item numbers and one pending request per person.
- Sessions are per workspace address, so opening another workspace from the switcher asks you to sign in
  there (creating a new workspace signs you in automatically).
- Google sign-in and Brevo email are covered by tests with fakes; they have not been exercised against
  the real services because they need credentials.
- Indirect changes can leave a space without an active admin (for example deleting the only admin group).
  Workspace admins can always repair it from the space's Members tab.
