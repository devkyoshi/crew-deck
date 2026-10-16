# Work Items and Kanban: checklist

Tick items (`[x]`) as they are finished and verified. Details for each line are in `PHASES.md`. Update `PROGRESS.md` at the end of each task.

## Before any phase

- [ ] Read `README.md`, the foundation `docs/BRIEF.md`, the work-items brief, `docs/DECISIONS.md`
- [ ] Read `apps/web/AGENTS.md` and the relevant Next.js docs in `node_modules/next/dist/docs/`
- [ ] Confirm `git status`; keep unrelated uncommitted work out of your commits
- [ ] Post the phase plan (migrations, endpoints, screens, risks) and get the owner's approval

---

## W1: Statuses, items and a read-only board

### Plan and pricing
- [x] Migration `0011_plan_work_items` (up/down): new feature/limit keys in seeded plans
- [x] `plans/index.ts` keys + `countWorkItems`; `lib/plans.ts` mirrored; `plans.test.ts` updated

### Database
- [x] Migration `0012_work_items` up and down: boards, space_counters, space_statuses, work_items, labels, work_item_labels
- [x] All new tables: `org_id`, `UNIQUE (id, org_id)`, composite FKs, FORCE RLS, policy, `crew_app` grant
- [x] Backfill existing spaces (board + 4 default statuses + counter); idempotent
- [x] New spaces get board, statuses, counter in the same transaction
- [x] Indexes for board query and title search; `schema-work.ts` added
- [x] Round trip `pnpm db:migrate` then `pnpm db:rollback` then migrate again

### Permissions
- [x] `Resource.isReporter` added; actions `item.view/create/edit/delete`, `status.manage`, `board.manage`
- [x] `permission-matrix.test.ts` rows (allowed and denied, all org and space roles)

### API
- [x] Statuses: list, create (max 12), patch, delete with `replace_with`, reorder
- [x] At-least-one-status-per-category enforced on create/patch/delete
- [x] Board: `GET /spaces/:id/board` (per-column cursor, 50 per page, Done retention, epics/subtasks excluded)
- [x] `PATCH /boards/:id` settings
- [x] Items: list, create (key from counter, hierarchy validation, work_items limit), get by id or key, patch with `If-Match` (412/428), soft delete, subtasks
- [x] `resolved_at` set on Done category and cleared on leaving it
- [x] Shared enums in `packages/shared`

### Web
- [x] `/design`: card (both densities), column header with WIP, type icons, priority icons, status chip, item panel skeleton, empty board, create row, in light and dark
- [x] Owner approved the `/design` components
- [x] Create-space wizard: board type step (Kanban; Scrum shown as coming soon / locked)
- [x] Space tabs + sidebar expansion (Board, Settings)
- [x] Board page: sticky headers, counts, WIP usage, skeletons, empty state, load more, error state, density toggle (per user)
- [x] Inline create per column and `C` create dialog (type tabs, grouped fields, create another)
- [x] Item side panel and full page `/spaces/[key]/items/[ref]` (one component), inline edit, saved indicator, 412 prompt, unsaved guard
- [x] Board settings: status editor (add, rename, recolor, reorder, WIP, category, delete with replacement)
- [x] Viewer read-only states; permission-denied and not-found states
- [x] Free plan limit message and upgrade prompt when `work_items` cap is reached

### Tests and docs
- [x] RLS tests for every new table; cross-tenant item/status/board tests
- [x] Concurrent create gives gap-free sequential keys
- [x] Hierarchy, status rules, `If-Match`, soft delete, retention tests
- [x] Lint, type-check, all tests pass
- [x] CHANGELOG entry (format of Phase 9), DECISIONS ADRs, FEATURES rows to Built, PROGRESS updated
- [x] **Done when:** a member can create items, see them in the right columns, keys are sequential per space, tenant isolation tests pass

---

## W2: Drag and drop and board power features

- [x] `fractional-indexing` added; ADR on string ranks vs CRM float positions
- [x] `POST /items/:id/move` (status, before/after neighbour, swimlane value, sprint) with `If-Match`, returns rank
- [x] Neighbour validation (same space and tenant); WIP info in response
- [x] `POST /items/bulk` (move, assign, label, delete; max 100)
- [x] Labels CRUD + `label.*` actions + matrix tests
- [x] Rank rebalance job (tenant queue, idempotent)
- [x] dnd-kit: handle button, keyboard sensor, announcements, "Move to" menu
- [x] Optimistic move, rollback toast, stale 412 handling
- [x] Drag visuals (lift, insertion line, valid column highlight, drop animation under 200 ms)
- [x] Filter bar with URL state, chips, quick filters (My items, Recently updated)
- [x] Swimlanes (None, Assignee, Epic, Priority) with Unassigned lane, collapse, counts, ownership confirmation
- [x] WIP warning on column header (icon plus text)
- [x] Column collapse, independent scroll, horizontal scroll
- [x] Multi-select + bulk bar
- [x] Card field settings in board settings
- [x] Card menu (assign, priority, move to, copy link, delete)
- [x] Shortcuts `C`, `/`, arrows, `?` overlay
- [x] 500-item demo seed; board smooth (profile checked); `@tanstack/react-virtual` where needed
- [x] Concurrency tests (two moves into the same gap), rank ordering tests, bulk permission tests
- [x] Docs updated; lint, type-check, tests pass
- [x] **Done when:** two people can move and reorder at the same time without lost updates, and a 500-item board stays smooth

---

## W3: Work item depth

- [ ] Migration `0014_work_item_depth`: comments, attachments, work_item_links, watchers, activity_events (RLS each)
- [ ] Storage adapter (`StorageDriver`, `LocalDiskDriver`, S3 stub documented); env names `STORAGE_DRIVER`, `STORAGE_DIR`, `STORAGE_SIGNING_SECRET`
- [ ] Ops Memory updated with storage env names and directory (no values)
- [ ] Attachments: signed upload/download, tenant-prefixed keys, mime sniff, blocked types, previews
- [ ] `max_attachment_mb` and `storage_mb` enforcement
- [ ] Comments CRUD, soft delete marker, mentions add watchers
- [ ] Links, watchers (auto reporter and first assignee), activity timeline for every mutation type
- [ ] Duplicate and transfer to another space
- [ ] New `can()` actions + matrix tests
- [ ] Tiptap `RichTextEditor`/`RichTextView` in `/design` first; autosave with saved state
- [ ] Detail view: subtasks (inline create, toggles, progress), links picker, attachments, tabs Comments/Activity/Watchers, all right-column fields
- [ ] Shortcuts `A`, `L`, `M`, `Esc`; parent-with-open-subtasks confirm
- [ ] Cross-tenant tests: comments, attachments (signed URL), links, watchers, activity
- [ ] Docs, lint, type-check, tests
- [ ] **Done when:** detail view matches brief section 6 and every action has permission and tenant tests

---

## W4: Search, list view and epics

- [ ] Migration `0015_search_filters`: saved_filters, search indexes, `search_text`
- [ ] `GET /search` with SQL-level access filtering; key matching
- [ ] `GET /me/items`
- [ ] Saved filters CRUD; shared filters gated by plan feature
- [ ] `GET /spaces/:id/epics` with progress
- [ ] List view: TanStack Table + Virtual, sort, column picker, bulk bar, CSV export (spreadsheet-safe)
- [ ] Epics page; My work page; nav entries
- [ ] Command palette item search; `/search` results page
- [ ] Tests: no cross-tenant or inaccessible-space results (admin, member, viewer, outsider); performance on 10k items
- [ ] Docs, lint, type-check, tests
- [ ] **Done when:** users find any accessible item by key or text quickly; results never include other tenants or inaccessible spaces

---

## W5: Notifications

- [ ] Migration `0016_notifications`: notifications, preferences, digest settings
- [ ] `notify()` after-commit service; fan-out worker; actor excluded; viewer rules; access re-check
- [ ] Event coverage: assigned, mentioned, watched comment, status change (reported/assigned), due within 24 h (daily job), sprint started/completed (wired in W6)
- [ ] Email through the existing queued sender, templates, 5-minute batching, optional daily digest
- [ ] API: list, mark read, preferences
- [ ] Bell with unread count, inbox page, preferences page, empty states
- [ ] Tests per event, preference suppression, batching, cross-tenant, job idempotency
- [ ] Docs, lint, type-check, tests
- [ ] **Done when:** the right people are notified on the right channels, never the actor

---

## W6: Backlog and sprints (Scrum)

- [ ] Migration `0017_sprints`: sprints (one-active partial unique), history, snapshots, `carry_over_count`
- [ ] Backlog endpoint; sprint create/edit; start (dates, item, confirm counts); complete (3 destinations); report; burndown
- [ ] Scope-change history on add/remove during active sprint
- [ ] Daily snapshot job, tenant-timezone aware, idempotent
- [ ] Board-type switch rules (active sprint blocks)
- [ ] `can()` actions `sprint.create`, `sprint.start`, `sprint.complete` + matrix
- [ ] Plan gates `scrum_sprints`, `burndown_reports`; UI locks; pricing page updated
- [ ] `/design`: sprint header; backlog page, epics panel, complete-sprint dialog, reports page with burndown (accessible chart + table)
- [ ] Notifications for sprint started/completed
- [ ] Tests: lifecycle, concurrency on start, carry-over, burndown fixture, snapshot job, permissions, cross-tenant
- [ ] Docs, lint, type-check, tests
- [ ] **Done when:** a full sprint can be planned, run and completed with carry-over, and the burndown matches recorded history

---

## W7: Live updates and hardening

- [ ] SSE endpoint with access check, tenant/space channels, heartbeat, reconnect; proxy settings; Ops Memory updated
- [ ] Client cache patching + reconnect indicator
- [ ] Accessibility and keyboard pass on every screen, reduced motion, AA contrast both themes, complete `?` overlay
- [ ] N+1 and index review, virtualization checks, load checks
- [ ] Demo seed (Kanban and Scrum spaces); migrations up/down and seed still work
- [ ] Playwright suite: create item, drag across columns, comment with mention, run a sprint, cross-tenant attack attempt; runs in CI
- [ ] Test that every route has a `can()` check; rate limits on search/comments/uploads
- [ ] Two browsers see each other's moves within about a second
- [ ] Docs, lint, type-check, tests
- [ ] **Done when:** the e2e suite passes in CI and live moves appear within about a second

---

## W8: Leftovers

- [x] Old keys of moved items resolve (`keyHistory`), item page shows the current key
- [x] Backlog and sprint lists can be reordered (`backlogRank`, `PUT /spaces/:id/backlog/order`)
- [x] List view virtualised (`@tanstack/react-virtual`)
- [x] Search covers comments and attachment names; older items rebuilt at start
- [x] S3 driver and config; deleting items frees attachment records and files
- [x] Daily summary email preference
- [x] Upgrade notice (`toastError` with "See plans"); pricing comparison rows
- [x] ADR numbers fixed, ADR-061, docs and Ops Memory updated
- [x] Tests: `work-leftovers.test.ts`
- [ ] Owner review and sign-off

## W9: Workflow rules and dependencies

- [x] Workflow transitions per space (editor, enforced on edit, move, bulk; transfers exempt)
- [x] Resolution on Done
- [x] Blocked / blocks badges on cards, warning on moving a blocked item, "Blocked" filter
- [x] Checklists on items with progress on cards, checklist templates
- [x] Tests, docs
- [ ] Owner review and sign-off

## W10: Versions and components

- [x] Versions with release flow and release notes; fix and affected versions on items
- [x] Components with lead and default assignee
- [x] Filters, pickers, Releases page, plan gate `releases`
- [x] Tests, docs
- [ ] Owner review and sign-off

## W11: Flow and reports

- [x] Status history (derived from activity, no backfill needed)
- [x] Velocity, cumulative flow, cycle time, created vs resolved (with data tables)
- [x] Plan gate `advanced_reports`
- [x] Tests, docs
- [ ] Owner review and sign-off

## W12: Roadmap, time tracking, calendar

- [x] Roadmap timeline for epics and versions with drag and keyboard alternative
- [x] Time tracking: original and remaining estimate, work logs, roll-ups
- [x] Calendar view of due dates
- [x] Tests, docs
- [ ] Owner review and sign-off

## W13: Dashboards, parity sweep, hardening

- [x] Dashboards with a fixed set of gadgets
- [x] `JIRA-PARITY.md` with no Missing rows inside the chosen scope
- [x] Accessibility, keyboard and rate-limit pass on new screens; live-update events for new entities
- [x] Demo seed and Playwright suite extended
- [x] Tests, docs
- [ ] Owner review and sign-off

---

## Definition of done (every phase, brief section 11)

- [ ] Lint, type-check and tests pass in CI
- [ ] New endpoints have permission tests (allowed and denied) and cross-tenant tests
- [ ] New screens have loading, empty and error states, work with the keyboard, and shared components appear on `/design`
- [ ] Migrations are reversible and the demo seed still works
- [ ] `docs/CHANGELOG.md` and `docs/DECISIONS.md` updated
- [ ] `docs/FEATURES.md` and `docs/PRICING.md` match what shipped
- [ ] `PROGRESS.md` and this checklist updated
- [ ] Ops Memory updated if servers, services, env var names or proxy config changed

## Cross-phase quality bar

- [ ] Skeletons shaped like final content; helpful empty states; friendly errors
- [ ] WCAG AA contrast, visible focus, never colour alone (icon or label with every colour)
- [ ] No layout shift when cards load or move
- [ ] Optimistic updates with rollback and a toast
- [ ] Responsive: tablet panel overlays board; mobile columns snap-scroll and item view is a full-screen sheet
- [ ] Light and dark themes verified; tenant accent used sparingly
