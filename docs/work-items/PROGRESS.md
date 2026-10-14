# Work Items and Kanban: progress

**Last updated:** 2026-10-14 (W3 built; awaiting owner review)
**Current phase:** W3, in Review. Next step: owner tries comments with mentions, attachments, links, activity, duplicate and move on an item, then W4 (search, list view and epics) can start with a plan
**Foundation prerequisite (Phases 0 to 5 of `docs/BRIEF.md`):** complete. Phases 0 to 9 are all shipped (HEAD at the time of writing: `0a311bb`).

## How to use this file

- Read it first. Pick up at "Current phase" and the first unticked item in `CHECKLIST.md`.
- At the end of every task: update the phase row, add a dated log line (newest first), tick `CHECKLIST.md`, and note blockers.
- Statuses: `Not started`, `Plan ready` (plan posted, awaiting approval), `In progress`, `Blocked`, `Review` (built, awaiting owner sign-off), `Done` (all "Done when" criteria met and the definition of done in `CHECKLIST.md` ticked).
- Never mark a phase Done on your own judgement if its `/design` components or screens still need the owner's approval; use `Review`.

## Phase status

| Phase | Title | Status | Started | Finished | Commit | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| W1 | Statuses, items and a read-only board | Review | 2026-10-14 | | | Built and tested: migrations 0011/0012, API, `can()` actions, plan gate, board, item panel and page, board settings, create-space board type, demo seed, 395 API tests, browser and accessibility tests. Deviations: see log |
| W2 | Drag and drop and board power features | Review | 2026-10-14 | | | Built and tested: move, bulk, labels, filters, swimlanes, WIP warnings, rebalance job, shortcuts, 420 API tests plus browser and accessibility tests. See log for deviations |
| W3 | Work item depth | Review | 2026-10-14 | | | Built and tested: rich text (Tiptap), comments and mentions, watchers, links, activity history, attachments on local storage with signed links, duplicate, transfer, 461 API tests plus browser and accessibility tests. See log |
| W4 | Search, list view and epics | Not started | | | | Search access filtering must be in SQL |
| W5 | Notifications | Not started | | | | Uses existing queued email sender (Brevo), not SendGrid |
| W6 | Backlog and sprints (Scrum) | Not started | | | | Scrum plan gate, burndown chart |
| W7 | Live updates and hardening | Not started | | | | SSE, Playwright, Ops Memory proxy note |

## Pricing track (runs alongside the phases, see `PRICING-GATES.md`)

| Item | Phase | Status |
| --- | --- | --- |
| Plan JSON update migration (`0011_plan_work_items`) | W1 | Done |
| `work_items` limit enforced on create | W1 | Done (API). Upgrade notice in UI pending |
| `scrum_sprints` gate (create Scrum space, start sprint) | W6 (UI lock shown from W1) | Not started |
| `max_attachment_mb` and `storage_mb` enforcement | W3 | Done (API, and the upload limit shows in the item panel) |
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

- 2026-10-14: W3 built and set to Review, in four commits on main. API: tenant collections `comments`, `work_item_links`, `watchers`, `activity_events` (append-only) and `attachments`; routes in `routes/work-depth.ts` (comments, watchers, links, activity), `routes/attachments.ts` (upload, list, delete, `GET /files/:id?e=&s=`) and `routes/work-copy.ts` (duplicate, transfer); rich text rebuilt from an allow-list (`work/rich-text.ts`), items accept `descriptionDoc`; activity recorded for create, field edits, moves, bulk changes, deletes, comments, links, attachments, duplicate and transfer; `can()` gained `comment.*`, `attachment.*`, `item.link/watch/duplicate/transfer`. Storage: `storage/index.ts` (`StorageDriver`, `LocalDiskDriver`, HMAC links bound to the workspace address, magic-byte sniffing), env `STORAGE_DRIVER`, `STORAGE_DIR`, `STORAGE_SIGNING_SECRET`, compose volume `files`. Web: `components/shared/rich-text.tsx`, `components/work/item-depth.tsx`, `lib/work-depth-api.ts`, shortcuts M, A, L. Changes from the plan: Mongo collections instead of SQL migrations; links may cross spaces (both ends must be visible; hidden ends are left out of lists); file links carry the signature in the query string (Fastify limits path parameters to 100 characters); only real PNG, JPEG, GIF and WebP show inline, everything else downloads; transfer refuses a subtask on its own and drops the epic of a moved story; old keys of moved items do not redirect. Not done: S3 driver (the interface is ready), notifications for mentions and watchers (W5), the `/design` showcase of the editor.
- 2026-10-14: W2 built and set to Review. API: `POST /items/:id/move` (camelCase body: `statusId`, `afterItemId` or `beforeItemId`, `assigneeId`, `priority`, `epicId`; `If-Match`), `POST /items/bulk`, labels routes, filter query on the board and its column route, `wipCount` (unfiltered) and `filtered` on the board response, rebalance job (`work/jobs.ts`, queue `work-rank-rebalance`), `can()` `label.create` and `label.manage`. Web: DnD in `board-view.tsx` (drag overlay portalled to body, custom keyboard coordinates, collision logic that resolves a column to its nearest card), `filter-bar.tsx`, `bulk-bar.tsx`, `label-bits.tsx`, `shortcuts-overlay.tsx`, swimlane and card-field settings. Changes from the plan: bodies are camelCase like the rest of the API; swimlane lanes are built from the cards loaded (first 50 per column), and the board says so when more exist; saved filters stay in W4; a collapsed column is not available while swimlanes are on. Not done: virtualised columns (50 per page plus Show more is used; 500 items load in about 2 seconds and drag smoothly in the browser test), live updates (W7). Edits of items now also take the space lock (a short wait when many people edit at once).
- 2026-10-14: W1 finished and set to Review. Web: Board tab, board with inline create and `C` shortcut, item side panel and full page, status editor in board settings, board type step in the create-space wizard, billing and pricing rows for work items, demo items on ENG and OPS. Browser test `e2e/work-items.spec.ts` (flow plus axe scan in light and dark). Fixes found by the scan: priority label contrast, unnamed category selects. Changes from the plan: the side panel and board settings are sheets (not routes); the card menu has Open, Move to, Copy link, Delete (drag and drop is W2); description is plain text until W3; `GET /spaces/:id/assignees` was added for the assignee picker; deleting a story or task deletes its subtasks, deleting an epic keeps its stories. Not done in W1: filter bar, swimlanes, labels UI, drag (all W2). Unrelated e2e failures seen: signed-out a11y specs and the admin CRM walk in demo-flow (CRM module is off for acme in the dev database), both outside work items.
- 2026-10-14: W1 backend built: migrations 0011 and 0012 (round trip verified), `can()` item/status/board actions with `isReporter`, routes `statuses.ts`, `board.ts`, `work-items.ts`, `src/work/`, plan keys and `work_items` usage, `boardType` on space create (Scrum answers 402 on Free, otherwise 422 not available yet), `fractional-indexing` added. Tests: `test/work-items.test.ts` (49), matrix rows, RLS rows. Web: `lib/work.ts`, `components/work/*`, `/design` section "Work management". Awaiting design approval.
- 2026-10-14: Brief split into phases W1 to W7. Created `docs/work-items/` (README, PHASES, PROGRESS, CHECKLIST, PRICING-GATES, UI-SPEC, DECISIONS-PENDING). Added ADR-041 to ADR-049 to `docs/DECISIONS.md`, planned-feature rows to `docs/FEATURES.md`, and a planned-limits note to `docs/PRICING.md`. No code written.
