# Work Items and Kanban Boards: agent handover pack

This folder turns `docs/Work Items and Kanban Boards Build Brief.md` (the "work-items brief") into a phased, trackable build. It is written so that an AI agent with no prior context can pick up the next unchecked task and carry on.

**Status of the module:** not started. Foundation Phases 0 to 9 are complete (see `docs/CHANGELOG.md`). No work-item code, tables or permissions exist yet.

## Reading order (do this before touching code)

1. `docs/BRIEF.md`: the foundation brief. Its rules, stack, multi-tenancy model and permission module apply to this module unchanged.
2. `docs/Work Items and Kanban Boards Build Brief.md`: the source of truth for behaviour. If this folder and the brief disagree, the brief wins; then fix this folder and note it in `PROGRESS.md`.
3. `docs/DECISIONS.md`: ADR-001 to ADR-040 already bind you (RLS pattern, `can()`, plans, dnd-kit accessibility ADR-036, fractional ordering ADR-034).
4. This folder, in this order: `PROGRESS.md` (where we are) -> `PHASES.md` (what to build) -> `CHECKLIST.md` (tick as you go) -> `UI-SPEC.md` (how it must look) -> `PRICING-GATES.md` (plan limits) -> `DECISIONS-PENDING.md` (decided and assumed answers).
5. `apps/web/AGENTS.md`: this Next.js version (16) has breaking changes. Read the relevant guide in `apps/web/node_modules/next/dist/docs/` before writing routes, layouts or proxy code. `src/proxy.ts` replaces `middleware.ts`.

## Files in this folder

| File | Purpose |
| --- | --- |
| `README.md` | This file: rules, glossary, how to work |
| `PROGRESS.md` | Live status per phase, current pointer, blockers, dated log. Update it at the end of every task |
| `PHASES.md` | W1 to W7 in full: scope, migrations, endpoints, permissions, screens, tests, risks, done criteria, plus a codebase map |
| `CHECKLIST.md` | Tickable checklists per phase, the definition of done, and the cross-phase quality bar |
| `PRICING-GATES.md` | How the module is gated by the Free, Team and Business plans, and the exact wiring per phase |
| `UI-SPEC.md` | Visual language and interaction spec: icons, colours, card anatomy, drag states, screens, empty states, accessibility |
| `DECISIONS-PENDING.md` | The brief's open decisions, with the answer chosen or assumed and what changes if it is reversed |

## Working rules (non-negotiable)

1. **One phase at a time**, W1 to W7, in order. Do not start a phase until the previous one meets its "Done when" criteria and `PROGRESS.md` says Done.
2. **Plan before code.** At the start of a phase, post a short plan (migrations, endpoints, screens, risks) and wait for the owner's approval. `PHASES.md` gives you a draft to start from; it is not approval.
3. **Respect the non-goals.** Do not build: custom workflow editors, transition validators, custom fields, automation rules, time tracking or worklogs, releases and versions, roadmap or Gantt views, dependency graphs, velocity or advanced reports (only a basic burndown), chat, wiki/docs, or the BA module. If a task seems to need one, stop and ask.
4. **Tenant safety.** Every new table carries `org_id`, `UNIQUE (id, org_id)`, composite foreign keys, `ENABLE` and `FORCE ROW LEVEL SECURITY`, the `tenant_isolation` policy and the `crew_app` grant block, copied from migration `0005` (spaces). Every module ships cross-tenant tests (`acme` vs `globex`).
5. **Permissions live in one place.** Add every new action to `apps/api/src/permissions/can.ts` and enforce it in the API route. The UI only mirrors it. Add rows to `permission-matrix.test.ts` (allowed and denied).
6. **Plans live on the server.** Gated features and limits go through `assertFeature` and `assertWithinLimit` (`apps/api/src/plans/index.ts`). See `PRICING-GATES.md`.
7. **Design system first.** Reuse `apps/web/src/components/ui/*` and `components/shared/*`. New shared components are added to the `/design` page (both themes) and approved by the owner before the full screens are built (the Board UI prompt in the brief, section 12, requires this).
8. **Migrations are hand-written, numbered and reversible** (`NNNN_name.up.sql` and `.down.sql` in `apps/api/src/db/migrations/`). The next free number is `0011`. Check the folder before choosing one, because other work may have landed.
9. **Small commits.** Run lint, type-check and tests before saying a task is done. Update `docs/CHANGELOG.md` and `docs/DECISIONS.md` at the end of each phase, using the existing format (see the Phase 9 entry).
10. **Ops Memory.** After any task that changes a server, service, port, cron job, proxy config or environment variable names, update `D:/projects/work-files/mochi-work` as described in the user's global `CLAUDE.md` (never write secret values). Doc-only and code-only work does not need it; file storage (W3) and the SSE proxy settings (W7) do.
11. **When the brief is ambiguous:** list the options with a recommendation and ask. Do not guess silently.

## Glossary

| Term | Meaning |
| --- | --- |
| Space | An existing foundation entity (key like `ENG`, roles admin/member/viewer). Work items live inside a space |
| Work item | Epic, story, task, bug or subtask. Key `{SPACE_KEY}-{n}`, for example `ENG-142` |
| Status | A board column. Belongs to one category: To do, In progress or Done. Max 12 per space |
| Category | Fixed three-way grouping that drives colour, `resolved_at`, remaining work and the "open items" filter |
| Board type | `kanban` (continuous flow) or `scrum` (backlog plus sprints) |
| Rank | A fractional-index string that orders items; moving a card rewrites one row |
| WIP limit | Optional per-status soft cap; shows a warning, never blocks |
| Space admin | Space role admin, plus org owners and org admins (they act as space admins everywhere) |
| `If-Match` | Header carrying the item's `updated_at`; stale writes get `412` |

## Hard facts about the repo (verified before this pack was written)

- API: Fastify 5, zod 4, Drizzle on postgres.js, hand-written SQL migrations, Redis sessions, BullMQ, Vitest.
- Web: Next 16, React 19, Tailwind 4, shadcn "new-york", TanStack Query and Table, dnd-kit, cmdk, sonner, react-hook-form. **Tiptap is not installed** (add it in W3). **`fractional-indexing` is not installed.** The CRM board (ADR-034) uses a floating-point midpoint `position`, which is not what the brief asks for. Work items need string ranks (brief section 2), so add the `fractional-indexing` package in W2 and record an ADR explaining why work items differ from CRM deals. The CRM `deal-board.tsx` is still the reference for the dnd-kit wiring and accessibility (ADR-036).
- No work-item, status, board, sprint, comment or attachment code exists. No file storage code exists. `storage_mb` is defined in plans but not enforced.
- Uncommitted work at the time of writing (not part of this module): sign-up name field (`0010_signup_name` migration, `routes/signup.ts`) and new auth components. Do not revert or mix it into work-item commits.
