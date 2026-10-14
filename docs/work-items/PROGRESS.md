# Work Items and Kanban: progress

**Last updated:** 2026-10-14 (planning documents written; no code started)
**Current phase:** W1, waiting for plan approval from the owner
**Foundation prerequisite (Phases 0 to 5 of `docs/BRIEF.md`):** complete. Phases 0 to 9 are all shipped (HEAD at the time of writing: `0a311bb`).

## How to use this file

- Read it first. Pick up at "Current phase" and the first unticked item in `CHECKLIST.md`.
- At the end of every task: update the phase row, add a dated log line (newest first), tick `CHECKLIST.md`, and note blockers.
- Statuses: `Not started`, `Plan ready` (plan posted, awaiting approval), `In progress`, `Blocked`, `Review` (built, awaiting owner sign-off), `Done` (all "Done when" criteria met and the definition of done in `CHECKLIST.md` ticked).
- Never mark a phase Done on your own judgement if its `/design` components or screens still need the owner's approval; use `Review`.

## Phase status

| Phase | Title | Status | Started | Finished | Commit | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| W1 | Statuses, items and a read-only board | Not started | | | | Migrations `0011`, `0012`. Needs owner approval of `/design` components before full screens |
| W2 | Drag and drop and board power features | Not started | | | | Adds `fractional-indexing`, `@tanstack/react-virtual` |
| W3 | Work item depth | Not started | | | | Adds Tiptap and the storage adapter (local disk). Ops Memory update needed |
| W4 | Search, list view and epics | Not started | | | | Search access filtering must be in SQL |
| W5 | Notifications | Not started | | | | Uses existing queued email sender (Brevo), not SendGrid |
| W6 | Backlog and sprints (Scrum) | Not started | | | | Scrum plan gate, burndown chart |
| W7 | Live updates and hardening | Not started | | | | SSE, Playwright, Ops Memory proxy note |

## Pricing track (runs alongside the phases, see `PRICING-GATES.md`)

| Item | Phase | Status |
| --- | --- | --- |
| Plan JSON update migration (`0011_plan_work_items`) | W1 | Not started |
| `work_items` limit enforced on create | W1 | Not started |
| `scrum_sprints` gate (create Scrum space, start sprint) | W6 (UI lock shown from W1) | Not started |
| `max_attachment_mb` and `storage_mb` enforcement | W3 | Not started |
| `shared_filters` gate | W4 | Not started |
| `burndown_reports` gate | W6 | Not started |
| Pricing page, plan comparison, billing usage, `PRICING.md`, `FEATURES.md` updated | with each gate | Not started |

## Decisions status

See `DECISIONS-PENDING.md`. All eight open decisions have a chosen or assumed answer; the owner may overturn any of them before the phase that depends on them starts. File storage (local disk behind an adapter) is confirmed by the owner. ADR numbers 041 to 049 are reserved for them in `docs/DECISIONS.md`.

## Blockers and questions for the owner

- None open. Ask here when blocked, and mention it in the hand-back message.

## Known repo state to be aware of

- Uncommitted files unrelated to this module: sign-up name field (`apps/api/src/routes/signup.ts`, `0010_signup_name.*`, `apps/web/src/components/auth/`, `apps/web/public/`) and edits in `globals.css`, `toggle-card.tsx`. Do not include them in work-item commits unless the owner says so.
- `docs/Work Items and Kanban Boards Build Brief.md` is untracked at the time of writing. The brief's own kickoff prompt expects it at `docs/WORK-ITEMS-BRIEF.md`; the file was left under its current name so as not to break the owner's references. Mention it, do not rename it without being asked.
- The brief mentions SendGrid; the platform uses Brevo through `apps/api/src/email/`. Use the existing sender.

## Log (newest first)

- 2026-10-14: Brief split into phases W1 to W7. Created `docs/work-items/` (README, PHASES, PROGRESS, CHECKLIST, PRICING-GATES, UI-SPEC, DECISIONS-PENDING). Added ADR-041 to ADR-049 to `docs/DECISIONS.md`, planned-feature rows to `docs/FEATURES.md`, and a planned-limits note to `docs/PRICING.md`. No code written.
