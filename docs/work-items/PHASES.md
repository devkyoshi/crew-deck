# Phases W1 to W7

Source: `docs/Work Items and Kanban Boards Build Brief.md` (section numbers below refer to it). Labels W1 to W7 avoid clashing with the foundation phases. Status lives in `PROGRESS.md`; ticks live in `CHECKLIST.md`.

## 0. Codebase map (reuse before you write)

### API (`apps/api`)

| Need | Where | Notes |
| --- | --- | --- |
| Permissions | `src/permissions/can.ts` | `can(actor, action, resource)`. `Action` is a union type; `Resource` has `spaceRole`, `spaceVisibility`, `isSelf`, `isManager`. **Add `isReporter?: boolean`** (W1) for "delete own reported items". Unknown actions are denied |
| Effective space role | `src/spaces/access.ts` | Highest of direct and group role. Org owner/admin act as space admin |
| Tenant context | `src/db/client.ts` `withTenant(db, orgId, fn)` | Transaction that sets `app.current_org`. Every query on tenant tables runs inside it |
| Migration pattern | `src/db/migrations/0005_*` (spaces), `0008_crm` | Copy the RLS block: `org_id`, `UNIQUE(id, org_id)`, composite FKs, `ENABLE`/`FORCE RLS`, `tenant_isolation` policy, `crew_app` grant in a `DO $$` block |
| Schema | `src/db/schema.ts`, `schema-crm.ts` | Add `schema-work.ts` for the new tables and export it where the others are |
| Migrate | `pnpm db:migrate` / `pnpm db:rollback` | Next free migration number: **0011** |
| Plans | `src/plans/index.ts` | `LIMIT_KEYS`, `FEATURE_KEYS`, `loadPlan`, `assertWithinLimit`, `assertFeature`, counters. 402 `plan_limit` / `feature_locked` |
| Routes | `src/routes/*.ts` | One file per resource; zod via `fastify-type-provider-zod`; register in `app.ts` |
| Errors | `src/plugins/error-handler.ts` | Consistent error shape; add a `412` mapping if missing |
| Audit | `src/audit/service.ts` | Org/space audit log (separate from per-item `activity_events`) |
| Queue/jobs | `src/lib/redis.ts` (`createTenantQueue`, `createTenantWorker`) | Tenant-prefixed keys, `orgId` in job data. Examples: `checkin/jobs.ts`, `plans/jobs.ts` |
| Email | `src/email/queue.ts`, `src/email/sender.ts` | Queued sender (Brevo). `EMAIL_MODE=log` for browser tests. **The brief says SendGrid; the repo uses Brevo. Use the existing queued sender and do not add a second provider** |
| Test helpers | `test/helpers.ts` | `makeApp()`, `call({method,url,slug,cookie,payload})`, `appDb()`, `adminDb()`, `tenantIds()` (acme, globex) |
| Test patterns | `test/rls.test.ts`, `test/permission-matrix.test.ts`, `test/spaces.test.ts`, `test/crm.test.ts` | Vitest, `fileParallelism: false`, separate `_test` database |

### Web (`apps/web`)

| Need | Where | Notes |
| --- | --- | --- |
| Space pages | `src/app/(app)/spaces/[key]/` (`layout.tsx`, `page.tsx`, `members/`, `settings/`) | Tabs are an array in `layout.tsx`. Add Board, Backlog (Scrum only), List, Epics, Reports |
| Space components | `src/components/spaces/` | Create-space wizard is `/spaces/new`; add board type there (W1) |
| Existing dnd-kit board | `src/components/crm/deal-board.tsx` | Reference for drag handle button, keyboard sensor, announcements, "Move to" menu (ADR-036) |
| Design page | `src/app/design/page.tsx`, `showcase.tsx` | Dev-only. Renders `Showcase` in light and dark side by side. Add new shared components here first |
| UI primitives | `src/components/ui/*` | alert-dialog, avatar, badge, breadcrumb, button, card, checkbox, collapsible, command, dialog, dropdown-menu, field, popover, progress, select, separator, sheet, sidebar, skeleton, sonner, switch, table, tabs, textarea, toggle-card, tooltip. **Missing and to add via shadcn when needed:** `scroll-area`, `resizable`, `calendar`, `toggle-group`, `context-menu`, `chart` |
| Shared | `src/components/shared/` | badges, empty-state, error-view, load-error, multi-picker, notice, page-header, pastel, pickers, stepper |
| Shell | `src/components/shell/` (`nav.ts`, `app-sidebar`, `command-palette`, `spaces-nav`) | Sidebar expands each space into Board/Backlog/List/Reports/Settings (W1+). Command palette extended in W4 |
| Plans | `src/lib/plans.ts` (`useHasFeature`, `formatLimit`), `components/plans/locked-button.tsx` | Mirror gates in the UI |
| Theme | `src/app/globals.css`, `components/shell/status-banners.tsx` (`Branding`) | oklch tokens; tenant accent drives `--primary`, `--ring`, `--sidebar-primary` |
| Libraries present | dnd-kit (core/sortable/utilities), TanStack Query and Table, cmdk, sonner, react-hook-form + zod, next-themes, lucide | **Add:** `@tanstack/react-virtual` (W2/W4), `fractional-indexing` (W2, API side; share via `packages/shared` if the client needs it), Tiptap (W3), a chart lib via shadcn `chart`/recharts (W6) |

### Conventions to keep

- Item addressing: by UUID or by key (`ENG-142`). Resolve the key with `(space.key, number)` inside the tenant.
- Cursor pagination on every list endpoint; same filter params as the UI: `assignee`, `type`, `priority`, `label`, `epic`, `status`, `due`, `q`.
- Mutations on items send `If-Match: <updated_at ISO>`; stale -> `412`. The move endpoint returns the item with its new rank.
- Every mutation writes an `activity_event` (from W3; in W1/W2 write the table rows too if the table exists, otherwise leave a clearly marked hook) and enqueues notification jobs where relevant (from W5).
- Errors: reuse the project's error shape. Plan failures are `402`.
- Soft delete only (`deleted_at`); never hard-delete history.

### Shared enums (put in `packages/shared`, used by API and web)

- Item types: `epic | story | task | bug | subtask`.
- Priorities: `highest | high | medium | low | lowest`.
- Status categories: `todo | in_progress | done`.
- Board types: `kanban | scrum`. Sprint states: `planned | active | closed`. Link types: `blocks | relates_to | duplicates`.
- Hierarchy rules: epic has no parent; story/task/bug may have an epic parent; subtask must have a story/task/bug parent; subtasks cannot have children; depth max 3.

---

## W1: Statuses, items and a read-only board

**Goal:** a member can create items, see them in the right columns of the space board, keys are sequential per space, tenant isolation holds.

**Prerequisites:** none beyond the foundation. Settle the open decisions in `DECISIONS-PENDING.md` (all have defaults).

**In scope:** brief section 10 W1, plus section 2 (core tables), section 3 (workflow), section 6 basic panel, section 7 (permissions for the listed actions).
**Out of scope:** drag and drop, move endpoint, filters, swimlanes, labels UI, comments, rich text, sprints, notifications.

### Migrations

- `0011_plan_work_items` (up/down): plan JSON changes from `PRICING-GATES.md` (new feature and limit keys). Small and separate so it can ship independently.
- `0012_work_items` (up/down), all with `org_id` and the RLS block:
  - `boards`: `id, org_id, space_id, type ('kanban'|'scrum'), name, settings jsonb (swimlane_mode, card_fields[], default_filter, done_retention_days default 14, density?), created_at, updated_at`. One board per space in v1 (`UNIQUE (space_id)`).
  - `space_counters`: `space_id (PK, composite FK), org_id, last_number int`.
  - `space_statuses`: `id, org_id, space_id, name, category ('todo'|'in_progress'|'done'), position int, color, wip_limit int null, created_at`. Constraint: name unique per space; trigger or app-level check for max 12 and at least one per category.
  - `work_items`: all columns in section 2: `number int`, `UNIQUE (space_id, number)`, `type`, `parent_id` (composite FK to itself), `title (<=255)`, `description jsonb null` (rich text JSON, filled in W3), `status_id` (composite FK), `priority default 'medium'`, `assignee_id`, `reporter_id`, `estimate numeric(5,1) null`, `due_date date null`, `sprint_id uuid null` (FK added in W6), `rank text not null`, `resolved_at`, timestamps, `deleted_at`. Indexes: `(space_id, status_id, rank) WHERE deleted_at IS NULL`, `(space_id, assignee_id)`, `(parent_id)`, text search index on `title` (pg_trgm or `tsvector`, decide in the W1 plan; needed by W4).
  - `labels` and `work_item_labels` (tables only; UI in W2).
  - Backfill: for every existing non-deleted space create a board (`kanban`), the four default statuses, and a `space_counters` row. New spaces get the same on creation in the same transaction.
- Down migrations drop in reverse dependency order.

### Key generation

`UPDATE space_counters SET last_number = last_number + 1 WHERE space_id = $1 RETURNING last_number` inside the create transaction. Numbers are never reused, even after soft delete or failed inserts being rolled back (a rolled-back transaction rolls the counter back too; that is fine because no key was exposed).

### Default statuses (brief section 3)

To Do (todo, default for new items), In Progress (in_progress), In Review (in_progress, removable), Done (done, sets `resolved_at`). Colours chosen from `UI-SPEC.md` category palette.

### `can()` actions to add

`item.view`, `item.create`, `item.edit`, `item.delete` (admin yes; member only if `resource.isReporter`; viewer no), `status.manage`, `board.manage` (admin only). Matrix per brief section 7. Add `isReporter` to `Resource`. Viewers pass `item.view` only. Private-space visibility rules follow `space.view`.

### API (all under `/api/v1`, `can()` on every route, zod validation)

| Method and path | Purpose | Notes |
| --- | --- | --- |
| `GET /spaces/:id/statuses` | List statuses in position order | any `item.view` |
| `POST /spaces/:id/statuses` | Add | `status.manage`; 409 at 12; body `{name, category, color?, wip_limit?}` |
| `PATCH /statuses/:id` | Rename, recolor, WIP limit, category change | Category change must leave at least one per category (422) |
| `DELETE /statuses/:id?replace_with=` | Delete with replacement | 422 if items exist and no `replace_with`, or if it is the last in its category. Moves items, appends to the replacement's end by rank, recomputes `resolved_at` |
| `PUT /spaces/:id/statuses/order` | Reorder | body `{ids: []}` must match the full set |
| `GET /spaces/:id/board` | Columns with items | Returns `{board, statuses[], columns: [{status_id, items[], next_cursor, total}], filters}`. Per column cursor, 50 per page. Hides Done items older than `done_retention_days` in Kanban spaces. Shows stories/tasks/bugs only (not epics; subtasks only as progress counts on parent) |
| `PATCH /boards/:id` | Board settings | `board.manage`; swimlane mode, card fields, retention. Board type change is allowed here but see W6 rules |
| `GET /spaces/:id/items` | List, cursor paginated | Filter params listed in Conventions |
| `POST /spaces/:id/items` | Create | `item.create`; `assertWithinLimit('work_items')`; defaults: status = first `todo` status, priority medium, reporter = caller; assigns key; rank = after last item in status. Hierarchy validated (422 with reason) |
| `GET /items/:ref` | Get by id or key | Includes status, assignee, reporter, parent summary, subtask progress |
| `PATCH /items/:id` | Update fields | `If-Match` required (428 if missing, 412 if stale); setting `status_id` to a done-category status sets `resolved_at`, moving back clears it; response includes new `updated_at` |
| `DELETE /items/:id` | Soft delete | `item.delete`; warns (does not block) when deleting a parent with children: response lists affected children, children are soft-deleted too in the same transaction |
| `GET /items/:id/subtasks` | Subtasks | |

Response items carry `key`, never expose `rank` meaning to clients beyond ordering.

### Web

1. **Design-page gate first.** Add to `/design` (light and dark) and get approval: work item card (comfortable and compact), column header with WIP, item type and priority icons, status chip, item panel skeleton, empty board, create row. Spec in `UI-SPEC.md`. Stop for approval before building full screens.
2. Create-space wizard: board type step (Kanban default, Scrum shown with a plan lock if `scrum_sprints` is not on the plan; Scrum content is not built until W6, so before W6 offer Kanban only and show Scrum as "Coming soon"; store `scrum` allowed only once W6 ships).
3. Space layout tabs: add **Board** (and List/Epics/Reports placeholders hidden until their phases). Sidebar `spaces-nav` expands a space to Board and Settings now.
4. Board page: columns (sticky headers, count, WIP usage), cards, loading skeletons shaped like columns, empty-board state ("Create the first item"), per-column "Load more", density toggle (comfortable/compact, remembered per user), error state with retry. Read-only for viewers (no create row).
5. Create: bottom-of-column inline create (title + Enter) and `C` shortcut opening the create dialog with type tabs, core, planning, relations groups and "create another" (fields not yet supported render disabled or hidden; do not fake them).
6. Item side panel (`Sheet`) and full page `/spaces/[key]/items/[ref]` using one `ItemDetail` component. W1 fields: title, type, status, assignee, reporter, priority, estimate, due date, parent epic, plain-text description (Tiptap arrives in W3). Inline edit with optimistic update, "Saved" indicator, `412` -> "changed by someone else" prompt with reload, unsaved-change protection.
7. Board settings (space admins): status editor (add, rename, recolor, drag-reorder with dnd-kit, WIP limit, category, delete with replacement dialog), swimlane/card-field controls shown but wired in W2.
8. Permission-denied and 404 states for items in spaces the user cannot see.

### Tests

- Migration up/down round trip.
- RLS: `rls.test.ts` additions for every new table (acme cannot read or write globex rows; cross-tenant FK impossible).
- Permission matrix: all W1 actions x six org roles x space roles (allowed and denied), including member-deletes-own-only.
- Items: sequential keys under concurrent creates (e.g. 20 parallel creates give 1..20 with no gaps or duplicates), hierarchy validation matrix, `If-Match` 412/428, `resolved_at` set and cleared, soft delete hides from board and list, plan limit 402 at `work_items` cap.
- Statuses: max 12, at-least-one-per-category, delete with replacement moves items, reorder validation.
- Board: Done retention hides old Done items in Kanban; epics and subtasks not shown as cards; per-column cursor.
- Web: type-check, lint; manual browser pass through create, edit, status editor, viewer role, Free plan limit message.

### Risks

- Counter contention on hot spaces (fine; row lock is short).
- `description` JSON column: store `null` or Tiptap JSON later; do not store HTML.
- Backfill must be idempotent and run inside the migration.
- Do not build Scrum behaviour; board type is only stored.

**Done when (brief):** a member can create items, see them in the right columns of the space board, keys are sequential per space, and tenant isolation tests pass.

---

## W2: Drag and drop and board power features

**Prerequisite:** W1 Done.
**Goal:** two people can move and reorder cards at the same time without lost updates; a board with 500 items stays smooth.

### Migrations

- `0013_work_items_w2` (if needed): `saved_filters` is W4, so only: index tuning for rank queries, `labels` unique `(space_id, lower(name))`.

### API

| Method and path | Purpose | Notes |
| --- | --- | --- |
| `POST /items/:id/move` | Move/reorder | Body `{status_id, before_item_id? | after_item_id?, swimlane_value?, sprint_id?}` plus `If-Match`. Server computes rank with `fractional-indexing` `generateKeyBetween(a, b)` using the neighbour's rank and the next/previous rank in the target column; returns the full item with new rank and `updated_at`. If neighbour ranks collide or are missing, fall back to end-of-column. Sets/clears `resolved_at`. WIP exceed is not an error; response includes `wip: {limit, count}` so the client can warn. Swimlane drop updates assignee/priority/epic in the same call. 412 on stale |
| `POST /items/bulk` | Bulk move, assign, label, delete | Body `{ids[], action, ...}`; max 100; per-item permission check; response lists succeeded and failed with reasons; one transaction per call (all or nothing) unless the plan says otherwise |
| `GET/POST /spaces/:id/labels`, `PATCH/DELETE /labels/:id` | Labels | `label.create` for admin and member; delete admin only (add action `label.manage`) |
| `GET /spaces/:id/board` | Extended | Accepts all filter params and `swimlane`; returns lanes when swimlane mode is on (Assignee, Epic, Priority; Unassigned lane) |
| Rank rebalance job | Background | BullMQ job via `createTenantQueue`: when any rank in a space exceeds ~40 characters, rewrite the space's ranks evenly (`generateNKeysBetween`). Runs with tenant context. Idempotent |

### Web

- dnd-kit with a drag handle button per card (no nested interactive elements), keyboard sensor, screen-reader announcements naming the card and the column (copy the ADR-036 approach from `crm/deal-board.tsx`), and a "Move to" menu on every card for non-drag users.
- Optimistic move with rollback and a toast explaining why on failure; stale `412` shows "changed by someone else" and refetches the column.
- Drag visuals per `UI-SPEC.md`: lift with slight rotation and soft shadow, insertion line, valid-column highlight, drop animation under 200 ms.
- Filter bar above the board: text search, assignee multi-select with avatars, type, priority, label, epic, due date, quick filters (My items, Recently updated). State in the URL (`?assignee=...&type=...`), removable chips, "Clear all".
- Swimlanes (None, Assignee, Epic, Priority): collapsible lanes with counts and an Unassigned lane; drop into a lane cell updates the lane field with a confirmation when ownership changes.
- WIP warnings on the column header (amber, icon plus text, never blocks).
- Column collapse, independent column scrolling, horizontal board scroll, "Load more" (50 per page).
- Multi-select with Ctrl/Cmd-click, bulk bar: move, assign, label, delete.
- Card field settings (board settings): choose which fields appear.
- Inline create per column: Enter creates, Shift+Enter keeps the input open; new items inherit filter/swimlane defaults.
- Card menu: assign, change priority, move to, copy link, delete. Shortcuts: `C`, `/`, arrow-key board navigation, `?` overlay (start the overlay here; it grows in later phases).
- Performance: render only visible cards per column if a column exceeds ~100 (TanStack Virtual) or rely on 50-per-page loading; memoise card components; verify with the 500-item seed (add a dev seed script `apps/api/src/db/seed-work-demo.ts` that creates 500 items across statuses).
- Refetch on window focus and after mutations (live updates come in W7).

### Plan gating

Free plan caps `work_items` (see `PRICING-GATES.md`). Bulk create/duplicate paths must also call `assertWithinLimit`. `shared_filters` gating arrives in W4.

### Tests

- Move: rank ordering between neighbours, to top/bottom, to empty column, across statuses, `resolved_at` toggling, stale 412, neighbour in another space rejected, neighbour in another tenant rejected.
- Concurrency: two simultaneous moves into the same gap both succeed with distinct, correctly ordered ranks (or the loser gets 412), never a lost update.
- Rank rebalance preserves order exactly.
- Bulk: per-item permission (member cannot bulk-delete others' items), max 100, tenant isolation.
- Labels: permission matrix, uniqueness, cross-tenant.
- Filter query params produce the expected SQL results and are tenant-scoped.
- Performance check: 500-item board loads under a budget (set in plan, e.g. < 400 ms API for first page of each column).

**Done when (brief):** two people can move and reorder cards at the same time without lost updates, and a board with 500 items stays smooth.

---

## W3: Work item depth

**Prerequisite:** W2 Done.
**Goal:** the detail view matches brief section 6, and every action has permission and tenant tests.

### Migrations

- `0014_work_item_depth`: `comments`, `attachments`, `work_item_links`, `watchers`, `activity_events` (all with the RLS block). `comments.body jsonb`, `edited_at`, `deleted_at`. `attachments`: `file_name, mime_type, size bigint, storage_key` (key starts with the org id). `work_item_links` unique `(from_item_id, to_item_id, link_type)`, no self links, same-tenant composite FKs. `activity_events` indexed `(work_item_id, created_at desc)`.

### Storage adapter (decided: local disk behind an adapter)

- Create `apps/api/src/storage/` with an interface `StorageDriver { put(key, stream, meta), get(key), delete(key), signedUrl(key, ttl) }`, a `LocalDiskDriver` (root from env `STORAGE_DIR`, outside the web root), and a stub `S3Driver` documented but unbuilt. Select by env `STORAGE_DRIVER` (`local` default).
- Keys: `{org_id}/{space_id}/{item_id}/{uuid}-{sanitised-name}`. Never trust client names; strip path separators.
- Uploads: `POST /items/:id/attachments` returns a short-lived signed upload target (local driver: a signed API URL that streams to disk). Downloads: `GET /attachments/:id` checks `item.view` for the item's space and tenant, then redirects/streams via a signed URL that expires in minutes (HMAC with `STORAGE_SIGNING_SECRET`; store only the NAME of these variables in Ops Memory).
- Enforce per-plan `max_attachment_mb` and workspace `storage_mb` (`PRICING-GATES.md`); track usage by summing `attachments.size` for non-deleted rows. Sniff mime type; block executables; images get previews, others download with `Content-Disposition: attachment`.
- Update Ops Memory (global CLAUDE.md) with the new env variable NAMES and the storage directory/volume on the VM.

### API

| Method and path | Notes |
| --- | --- |
| `GET/POST /items/:id/comments`, `PATCH/DELETE /comments/:id` | Rich text JSON body; author edit/delete own, admins delete any; delete is soft with a visible "comment deleted" marker; `@mentions` stored as node attrs with user ids; each mention adds a watcher (and in W5 a notification). Viewers cannot comment |
| `POST /items/:id/attachments`, `GET /attachments/:id`, `DELETE /attachments/:id` | As above |
| `POST /items/:id/links`, `DELETE /links/:id` | Types `blocks`, `relates_to`, `duplicates`; picker search by key or title uses the W4 search later, for now `GET /spaces/:id/items?q=` |
| `PUT/DELETE /items/:id/watch` | Reporter and first assignee are auto-watchers |
| `GET /items/:id/activity` | Cursor paginated timeline; every field change, status move, assignment, comment, attachment and link writes an event with `field`, `old_value`, `new_value` |
| `POST /items/:id/duplicate` | Copies fields and subtasks (not comments/attachments/history); new key; counts against `work_items` limit |
| `POST /items/:id/transfer` | Move to another space the caller can edit in: new key, keeps history, remaps status by category/name, clears sprint, records an event in both spaces |
| Item PATCH | Extend to `description` (Tiptap JSON), type change (re-validate hierarchy), labels |

Add `can()` actions: `comment.create`, `comment.editOwn`, `comment.deleteAny` (admin), `attachment.add`, `attachment.delete`, `item.link`, `item.watch`, `item.transfer`, `item.duplicate`.

### Web

- Install Tiptap (`@tiptap/react`, `starter-kit`, task list/item, table, code block, mention extension). Create a reusable `RichTextEditor` and `RichTextView` in `components/shared/`, show on `/design`. Autosave (debounced ~800 ms) with explicit saved state; mention suggestions from space members (use the existing `pickers`/`multi-picker` patterns).
- Item detail completes brief section 6: subtasks list with inline create, status toggle and progress bar; linked items with add-link picker; attachments with drag-and-drop, progress and image previews; tabs Comments, Activity, Watchers; right-column fields including labels, sprint (Scrum only, W6); watch/unwatch, copy link/key, duplicate, transfer, delete.
- Shortcuts: `A` assign, `L` label, `M` comment, `Esc` close.
- Concurrency UX: stale edit prompt; unsaved-change guard.
- Confirm prompts: closing a parent with open subtasks; deleting a parent.

### Tests

- Permission allowed/denied for each new action across org and space roles.
- Cross-tenant tests for comments, attachments (including: a signed URL for a globex attachment fails for an acme user; storage key prefix is the caller's org), links (cross-tenant and cross-space link rejection as configured), watchers, activity.
- Attachment limits: oversize 402/413, storage quota 402, disallowed type 415, path traversal in names neutralised, expired signed URL 403/410.
- Activity event emitted for each mutation type.
- Transfer: new key, history preserved, status remap, permissions in both spaces.
- Mentions: user from another tenant or without space access cannot be mentioned/notified.

**Done when (brief):** the detail view matches section 6 and every action has permission and tenant tests.

---

## W4: Search, list view and epics

**Prerequisite:** W3 Done.
**Goal:** a user finds any item they can access by key or text quickly, and results never include other tenants or inaccessible spaces.

### Migrations

- `0015_search_filters`: `saved_filters (id, org_id, owner_id, space_id null, name, query jsonb, is_shared)`. Search indexes: trigram on `work_items.title`, GIN `tsvector` over title and a plain-text projection of the description (maintain a `search_text` column updated on write, since description is JSON), unique lookup on `(space_id, number)`.

### API

| Method and path | Notes |
| --- | --- |
| `GET /search?q=&space=&type=...` | Key match first (`ENG-142`, `eng 142`), then text rank. **Access filtering happens in the SQL** (join to effective space access: open spaces the user can view, private spaces where they are a member or via group, org admins everywhere). Never filter after the fact. Cursor paginated, max 25 for palette, 50 for page |
| `GET /me/items` | Assigned to or reported by me, grouped by space or status; same SQL-level access filter |
| `GET/POST /filters`, `PATCH/DELETE /filters/:id` | Personal filters for everyone including viewers; shared filters need `filter.share` (admin, member) and plan feature `shared_filters` |
| `GET /spaces/:id/epics` | Epics with child counts and progress (done points or done count / total) |
| List endpoint | `GET /spaces/:id/items` gains sort, column selection, CSV export (`GET /spaces/:id/items.csv`, spreadsheet-safe like ADR-031, respects filters, capped rows) |

### Web

- List view (`/spaces/[key]/list`): TanStack Table, TanStack Virtual, sortable columns, column picker (remembered), filters shared with the board filter bar, bulk actions bar, CSV export.
- Epics page (`/spaces/[key]/epics`): list with progress bars, expandable to children, create epic, epic filter integration on board/list.
- My work page (`/my-work`): grouped by space or status, saved filters sidebar. Add to `nav.ts`.
- Command palette (extend `components/shell/command-palette.tsx`): Ctrl/Cmd+K matches item keys and titles across accessible spaces, shows type icon, status chip, space key; Enter opens the item. Full results page `/search` with filters.
- Saved filters menu on board/list: save current URL state, personal or shared (shared locked behind plan feature).
- `/` focuses search.

### Tests

- Search never returns: other tenant's items, items in private spaces the user is not in, soft-deleted items, archived-space items if archive hides them. Test with org admin vs member vs viewer vs outsider user.
- Key lookup variants. Saved filter visibility (owner vs shared vs other tenant). Plan gate on shared filters.
- Performance: search over 10k seeded items under a budget; `EXPLAIN` shows index use.

**Done when (brief):** a user finds any item they can access by key or text quickly, and results never include other tenants or inaccessible spaces.

---

## W5: Notifications

**Prerequisite:** W4 Done (W3 mentions and watchers exist).
**Goal:** assignments, mentions, comments and status changes notify the right people on the right channels, and never the person who caused them.

### Migrations

- `0016_notifications`: `notifications (id, org_id, user_id, type, work_item_id, actor_id, data jsonb, read_at, created_at)`, `notification_preferences (org_id, user_id, event_type, in_app bool, email bool)`, `notification_digest_settings (user_id, daily_digest bool, time)`, email batching table or Redis keys for the 5-minute window.

### Events (brief section 7)

Assigned to you; @mentioned; new comment on a watched item; status change on an item you reported or are assigned; due within 24 hours (daily job); sprint started or completed in a space you belong to (wired in W6). Rules: never notify the actor; viewers only get mentions and watched items; users without access to the item never get a notification (re-check access when delivering, not only when enqueuing).

### Implementation

- A single `notify(event)` service called after commit by mutation routes (use an outbox row or enqueue after the transaction commits, never inside it, so rolled-back changes do not notify).
- BullMQ worker (`createTenantWorker`) fans out to in-app rows and queued emails via the existing `email/queue.ts` sender (extend it with templates for work-item events; plain, branded with workspace name; links to `/spaces/ENG/items/ENG-142`).
- Email batching: collect events per recipient in a 5-minute window and send one email summarising them. Optional daily digest per preference.
- Due-date reminder job: daily, per tenant, uses `createTenantQueue`, sets tenant context first.

### API

`GET /notifications` (cursor, `unread=1`), `POST /notifications/read` (ids or all), `GET/PUT /me/notification-preferences`.

### Web

Bell in the topbar with unread count (poll on focus until W7), popover with latest, `/notifications` inbox with unread filter and mark all read, preferences page (event type x channel matrix, digest toggle). Empty state: "You are all caught up".

### Tests

Per event: correct recipients, actor excluded, viewer rules, preference off suppresses channel, batching merges, cross-tenant (a mention of a globex user id fails), notification for an item the recipient lost access to is dropped, due-date job idempotent per day, emails in `EMAIL_MODE=log` captured.

**Done when (brief):** assignments, mentions, comments and status changes notify the right people on the right channels, and never the person who caused them.

---

## W6: Backlog and sprints (Scrum)

**Prerequisite:** W5 Done.
**Goal:** a full sprint can be planned, run and completed with carry-over, and the burndown matches the recorded history.

### Migrations

- `0017_sprints`: `sprints (id, org_id, space_id, name, goal, start_date, end_date, state, started_at, closed_at)` with a partial unique index so only one `active` sprint per space; add the FK from `work_items.sprint_id`; `work_items.carry_over_count int default 0`; `sprint_items_history (sprint_id, work_item_id, added_at, removed_at, estimate_at_add)`; `sprint_snapshots (sprint_id, date, total_points, remaining_points)` unique `(sprint_id, date)`.

### API

| Method and path | Notes |
| --- | --- |
| `GET /spaces/:id/backlog` | Sections: active sprint, planned sprints, backlog (no sprint), with item counts and total points per section; Scrum spaces only (422 for Kanban) |
| `GET/POST /spaces/:id/sprints`, `PATCH /sprints/:id` | Create (default name "Sprint N"), edit; `sprint.create` for admin and member; closed sprints read-only |
| `POST /sprints/:id/start` | `sprint.start` (admin only); `assertFeature('scrum_sprints')`; needs start and end dates and at least one item; only one active; returns counts for the confirmation |
| `POST /sprints/:id/complete` | `sprint.complete` (admin only). Body: where unfinished items go (`planned_sprint_id`, `new_sprint`, or `backlog`). Done items stay. Increments `carry_over_count`, writes history rows, sets `closed_at`, one transaction |
| `GET /sprints/:id/report` | Completed, not completed, added after start |
| `GET /sprints/:id/burndown` | `assertFeature('burndown_reports')`; ideal line, actual remaining, scope-change markers from `sprint_items_history` |
| Move endpoint | Accepts `sprint_id`; add/remove during an active sprint writes history |
| Snapshot job | Daily at each tenant's local midnight (use the workspace timezone setting) writing `sprint_snapshots` for active sprints. Idempotent via the unique key; tenant context set first |
| Board type switch | `PATCH /boards/:id` to change type: refused with 409 if the space has an active sprint ("complete it first"); Kanban -> Scrum keeps items (all open items go to the backlog); Scrum -> Kanban requires no active sprint and detaches planned-sprint items to the backlog |

Estimates on subtasks are optional and are never double-counted with the parent.

### Web

Backlog page with ranked sections, sprint headers (dates, counts, points, Start/Complete), drag between sections (reuse W2 DnD), epics panel on the left (`ResizablePanel`), inline create per section, create sprint button, empty-sprint prompt. Start sprint confirmation. Complete sprint three-step dialog (summary, where unfinished items go, confirm). Board in a Scrum space shows only the active sprint (empty state: "No active sprint. Start one from the backlog"). Reports page: sprint selector, burndown chart (shadcn `chart`; follow the dataviz skill for accessible colours; ideal vs actual with scope-change markers and a table fallback), sprint report list. Card shows carry-over badge. Create-space wizard and board settings now allow Scrum with plan lock. Sprint header goes on `/design` first.

### Tests

Lifecycle state machine (invalid transitions 409/422), one active sprint under concurrency, start needs dates + item, complete with each of the three destinations, carry-over counts, history on mid-sprint add/remove, burndown values equal a hand-computed fixture, snapshot job idempotent and timezone-aware, board-type switch rules, permission matrix (members cannot start/complete), plan gate (Free cannot start a sprint), cross-tenant for sprints/history/snapshots.

**Done when (brief):** a full sprint can be planned, run and completed with carry-over, and the burndown matches the recorded history.

---

## W7: Live updates and hardening

**Prerequisite:** W6 Done.
**Goal:** the end-to-end suite passes in CI, and two browsers see each other's moves within about a second.

### Work

- `GET /spaces/:id/events` server-sent events. Authenticate by session cookie, check space access on connect and re-check periodically; scope channels by `org:{id}:space:{id}`; fan out via Redis pub/sub published after commit; heartbeat comments every 20 s; `Last-Event-ID` resume where cheap; connection cap per user. Events: item created/updated/moved/deleted, comment added, sprint started/completed, status changes. Client: invalidate or patch the TanStack Query cache; keep refetch-on-focus as fallback; show a subtle "reconnecting" state. Check the reverse proxy config for SSE (buffering off) and **update Ops Memory** (nginx/proxy settings are a config change).
- Accessibility and keyboard pass over every screen: tab order, focus rings, roles/labels for drag handles, announcements, contrast (AA) in both themes, reduced-motion support, the `?` shortcuts overlay complete.
- Query review: remove N+1 queries (assignee/labels/parent joins on board and list), verify indexes with `EXPLAIN`, confirm virtualization on list and long columns, load test 500-item board and 10k-item search.
- Demo seed: extend demo seed data with a Kanban space and a Scrum space (items of all types, labels, one closed sprint with history, one active sprint) and make sure the migration up/down plus seed still works.
- Playwright end-to-end suite (check whether the repo already has Playwright; if not, add it under `apps/web/e2e` or a root `e2e/`, with `EMAIL_MODE=log`): create item; drag across columns; comment with mention; run a sprint; cross-tenant attack attempt (try to open another tenant's item key, API ids, attachment URL, SSE channel). Wire into CI.
- Hardening: rate limits on search/comments/uploads, request size limits, audit of all `can()` actions vs routes (a test that fails if a route has no permission check), final cross-tenant sweep.

### Tests

SSE: authorised client receives events within ~1 s; a user without space access gets 403; tenant B never receives tenant A events; access revoked mid-stream closes the stream. Full e2e suite green in CI.

**Done when (brief):** the end-to-end suite passes in CI, and two browsers see each other's moves within about a second.

---

## W8 to W13: leftovers and Jira Software parity

Added on 2026-10-15 after W1 to W7 were built. Scope: close the known gaps, then add what a software team uses daily in Jira. Out of scope (raise as new briefs): Service Management (queues, SLAs, forms), approvals, custom fields and item types, automation rules, a query language, SSO. Data lives in MongoDB, so "migrations" mean new collections and indexes created at API start (`db/indexes.ts`). Each phase ends in `Review`.

### W8: Leftovers (built)

Old-key redirects (`keyHistory`), backlog ordering (`backlogRank`), virtualised list, search in comments and file names, S3 driver and file cleanup on delete, daily summary email, upgrade notice and pricing rows, ADR renumbering. See `PROGRESS.md`.

### W9: Workflow rules and dependencies (built)

- Per-space allowed transitions (`from -> to`), default any to any; editor in board settings; enforced in `work/service.ts` for edit, move, bulk and transfer (422 with a reason). `can()` action `workflow.manage` (admin).
- Resolution (Fixed, Won't do, Duplicate, Cannot reproduce) when moving to a Done status.
- Dependency awareness: "blocked by N" and "blocks N" on cards (open blockers only), a warning (never a block) when moving a blocked item forward, a "Blocked" filter.
- Checklists on items with progress on cards, and reusable checklist templates per space.

### W10: Versions and components (built)

- Collections `versions` (name, description, start and release dates, state unreleased, released, archived) and `components` (name, lead, default assignee); item fields `fixVersionIds`, `affectsVersionIds`, `componentIds`.
- Release action lists open items and moves them to another version or none; release notes grouped by type; filters on board, list, search and CSV; default assignee on create. Plan gate `releases`.

### W11: Flow and reports (built)

- `status_changes` collection (item, from, to, at) fed by every status change, backfilled from `activity_events`.
- Velocity (last six sprints), cumulative flow, control chart with cycle-time percentiles, created vs resolved; each with a data table. Plan gate `advanced_reports`.

### W12: Roadmap, time tracking, calendar

- Roadmap timeline of epics and versions (start and due dates, drag and resize, zoom, date fields as the keyboard alternative). Plan gate `roadmap`.
- Time tracking: original and remaining estimate, work logs (`worklogs`), roll-ups on epics. `can()` actions `worklog.add`, `worklog.editOwn`, `worklog.deleteAny`.
- Calendar view of due dates.

### W13: Dashboards, parity sweep, hardening

- Per-user dashboards from a fixed set of gadgets (assigned to me, created vs resolved, sprint health, saved filter results, version progress).
- `JIRA-PARITY.md`: a row per Jira Software feature (Built, Partial, Out of scope) with where it lives in the app.
- Accessibility, keyboard shortcuts, rate limits, live-update events for new entities, demo seed and Playwright coverage for W9 to W12.

## After W7

Not in this module: Kanban sprints, custom item types and fields, automation, Service Management, a query language, chat and wiki. Raise them as new briefs.
