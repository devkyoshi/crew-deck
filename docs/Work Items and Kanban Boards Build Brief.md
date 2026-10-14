# Work Items and Kanban Boards: Build Brief

Oct 14, 2026 · @Ashi

## 1. Overview

This brief covers the work management module of the multi-tenant company platform: work items, Kanban boards, backlog and sprints. It plugs into the foundation already defined in the _Company Workspace Platform: Build Brief_, and **that brief's rules, tech stack, tenancy model and permission module apply here unchanged**. Work items live inside spaces, so the foundation (tenants, members, groups, spaces, space roles) must be built first.

**Goals**

- Every space has a board where members create, view and move work items
- A space chooses its board type: **Kanban** (continuous flow) or **Scrum** (backlog plus sprints)
- Work items support types and a parent/child hierarchy, priority, assignee, estimate, labels, due date, rich-text description, comments, attachments and a full activity history
- Each space can configure its own statuses (board columns), within fixed status categories
- Fast search and filtering, with saved filters, across a space and across all spaces a user can access
- In-app and email notifications for assignments, mentions and status changes
- A polished, Jira-grade UI with smooth drag-and-drop

**Non-goals for this module (do not build)**

- Custom workflow editors with transition validators, screens or post-functions (use the simple model in section 3)
- Custom fields beyond the built-in ones and labels
- Automation rules, time tracking, worklogs, releases and versions
- Roadmap or Gantt views, advanced dependency graphs
- Velocity and advanced reports (only a basic burndown for Scrum spaces)
- Chat, wiki/docs, and the BA module (requirements, traceability)

If a task seems to need one of these, stop and ask instead of adding it.

## 2. Core concepts and domain model

Every record below carries `org_id` (the tenant key) and, where relevant, `space_id`. The rules in the foundation brief's multi-tenancy section apply to every table.

&#91;embedded content: work item hierarchy · 5 types, 3 levels\]

Epics group work across sprints. Stories, tasks and bugs are the items teams actually move across the board, and any of them can break down into subtasks. Subtasks cannot have children, so depth is capped at three levels and enforced by the API.

**Key concepts**

- **Work item key:** `{SPACE_KEY}-{number}` (for example `ENG-142`). The number is sequential per space, generated atomically, and never reused
- **Status:** a column on the board. Each status belongs to a fixed **category**: To do, In progress or Done. Spaces can add, rename and reorder statuses, but every space keeps at least one status per category
- **Board type:** Kanban (no sprints; all non-done items are on the board) or Scrum (backlog plus sprints; the board shows only the active sprint)
- **Rank:** items are ordered with fractional indexing (a string rank per item) so reordering changes one row, not many

**Core tables** (all carry `org_id`)

| Table                       | Key fields                                                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| space\_counters             | space\_id, last\_number (atomic increment for item numbers)                                                                                                                                                                               |
| space\_statuses             | id, space\_id, name, category, position, color, wip\_limit                                                                                                                                                                                |
| boards                      | id, space\_id, type (kanban or scrum), name, settings (swimlane mode, card fields, default filter)                                                                                                                                        |
| work\_items                 | id, space\_id, number, type, parent\_id, title, description (rich text JSON), status\_id, priority, assignee\_id, reporter\_id, estimate (story points), due\_date, sprint\_id, rank, resolved\_at, created\_at, updated\_at, deleted\_at |
| sprints                     | id, space\_id, name, goal, start\_date, end\_date, state (planned, active, closed), started\_at, closed\_at                                                                                                                               |
| labels / work\_item\_labels | label: id, space\_id, name, color. Join: work\_item\_id, label\_id                                                                                                                                                                        |

**Supporting tables** (all carry `org_id`)

| Table                  | Key fields                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| comments               | id, work\_item\_id, author\_id, body (rich text JSON), edited\_at, deleted\_at                         |
| attachments            | id, work\_item\_id, uploader\_id, file\_name, mime\_type, size, storage\_key                           |
| work\_item\_links      | id, from\_item\_id, to\_item\_id, link\_type (blocks, relates\_to, duplicates)                         |
| watchers               | work\_item\_id, user\_id                                                                               |
| activity\_events       | id, work\_item\_id, actor\_id, event\_type, field, old\_value, new\_value, created\_at                 |
| sprint\_items\_history | sprint\_id, work\_item\_id, added\_at, removed\_at, estimate\_at\_add (drives carry-over and burndown) |
| sprint\_snapshots      | sprint\_id, date, total\_points, remaining\_points (written daily by a job)                            |
| saved\_filters         | id, owner\_id, space\_id (null = all spaces), name, query (JSON), is\_shared                           |
| notifications          | id, user\_id, type, work\_item\_id, actor\_id, read\_at, created\_at                                   |

**Rules**

- Soft-delete work items and comments (`deleted_at`). Never hard-delete history
- Moving an item to a Done-category status sets `resolved_at`; moving it back clears it
- Deleting a status requires moving its items to another status first
- Closing a parent epic does not auto-close children; show a warning instead

## 3. Workflows and statuses

We use a deliberately simple workflow model. Each space has an ordered list of statuses, and each status belongs to one of three fixed categories. This gives Jira-style columns without the cost of a full workflow editor.

&#91;embedded content: default status flow · 4 statuses, 2 return paths\]

The drawing shows the default flow every new space starts with. It is a convention, not a rule: in this module any item can be moved to any status, so teams are never blocked by tooling.

**Default statuses for a new space**

| Status      | Category    | Notes                             |
| ----------- | ----------- | --------------------------------- |
| To Do       | To do       | Default status for new items      |
| In Progress | In progress |                                   |
| In Review   | In progress | Can be removed by the space admin |
| Done        | Done        | Sets `resolved_at`                |

**Rules**

- Space admins can add, rename, recolor, reorder and delete statuses, up to a maximum of 12 per space
- Every space always keeps at least one status in each category
- Deleting a status requires choosing a replacement status for its items
- The category drives behavior: board column color, `resolved_at`, what counts as remaining work in a sprint, and what the "open items" filter returns
- **WIP limits** are optional per status. Exceeding a limit shows a warning on the column header and does not block the move
- Moving a parent with open subtasks to a Done status shows a confirmation prompt, and does not auto-close the subtasks
- Every status change is written to `activity_events` and can trigger notifications to the assignee, reporter and watchers
- A later phase can add optional transition restrictions per space. Do not build them now

## 4. Kanban board behavior

The board is the centerpiece of the module, so it has to feel fast and predictable. Both Kanban and Scrum spaces use the same board component; the difference is which items it shows (all open items vs. the active sprint).

**Layout and cards**

- One column per status in position order. The header shows the status name, item count, and WIP usage (for example 3 of 5)
- Columns scroll vertically on their own, with sticky headers. The board scrolls horizontally, and columns can be collapsed
- Cards show: key, title, type icon, priority icon, assignee avatar, estimate, up to two labels plus a count, due date (red when overdue), parent epic chip, subtask progress (for example 2 of 5), and comment and attachment counts. Space admins choose which fields appear
- The board shows stories, tasks and bugs. Epics are reached through an epic filter and panel, and subtasks appear as progress on their parent (a setting can show them as cards)
- In Kanban spaces, Done items older than a configurable number of days (default 14) are hidden from the board but remain searchable

**Drag and drop**

- Cards drag between columns and reorder within a column, using dnd-kit. Keyboard dragging and screen-reader announcements are required
- The update is optimistic. The client sends the target status and the neighbor item (`before_item_id` or `after_item_id`), and the server calculates the new rank and returns the authoritative result
- On failure the card snaps back and a toast explains why. Updates use a version check (`If-Match` on `updated_at`) so two people moving the same card never silently overwrite each other
- Dropping into a swimlane cell also updates the swimlane field (for example the assignee), with a confirmation when that changes ownership

**Ranking**

- Each item has a string `rank` from fractional indexing. Moving a card rewrites only that item's rank
- A background job rebalances ranks when keys grow long, per space and per tenant

**Swimlanes**

- Board setting with four modes: None, Assignee, Epic, Priority. Lanes are collapsible, include an Unassigned lane, and show item counts

**Filters and search**

- A filter bar above the board: text search, assignee (multi-select with avatars), type, priority, label, epic and due date, plus quick filters (My items, Recently updated)
- Filters are stored in the URL so any view can be shared, and can be saved as a named filter (personal or shared with the space)

**Creating and editing**

- A "Create" row at the bottom of every column: type a title, press Enter, and the item is created in that status. Shift+Enter keeps the input open for rapid entry. A global `C` shortcut opens the full create dialog
- New items inherit sensible defaults from the active filters and swimlane (for example the assignee or label)
- Clicking a card opens the detail view in a side panel so the board stays visible. A card menu offers assign, change priority, move to, copy link and delete
- Multi-select with Cmd/Ctrl-click enables bulk move, assign and label changes

**Board settings (space admins)**

- Edit statuses and WIP limits, choose swimlane mode and card fields, set Done-item retention, and define quick filters

**Live updates:** the first version refetches on window focus and after mutations. A later phase adds server-sent events so changes by other people appear without a refresh.

## 5. Backlog and sprints

Sprints apply to **Scrum spaces only**. In a Kanban space there are no sprints, and the leftmost status acts as the backlog.

**Backlog view (Scrum spaces)**

- One ranked list, grouped into sections: the active sprint at the top, planned sprints below it, then the backlog (items with no sprint)
- Drag items to reorder them or move them between sections. Each section header shows item count and total story points
- A collapsible epics panel on the left filters the list by epic, with progress per epic
- Inline create at the bottom of each section, the same filter bar as the board, and bulk actions through multi-select
- Create sprint button at the top; empty sprints show a clear prompt to drag items in

**Sprint lifecycle**

| State   | Meaning                     | Rules                                                                                                                            |
| ------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Planned | Created, being filled       | Name (default "Sprint N"), goal, optional dates. Any number can exist                                                            |
| Active  | Running, shown on the board | Only one active sprint per space. Starting needs start and end dates and at least one item, and shows a confirmation with counts |
| Closed  | Finished                    | Read-only. Keeps its items and history, and appears in the sprint reports list                                                   |

**Rules**

- Adding or removing items during an active sprint is allowed and is recorded in `sprint_items_history`, so scope changes show up in reports
- **Complete sprint** opens a dialog that lists done and not-done items. The user chooses where unfinished items go: an existing planned sprint, a new sprint, or back to the backlog. Done items stay with the closed sprint
- Carry-over is recorded. A card shows how many sprints an item has been carried through
- Estimates are story points, with a selector of common values (1, 2, 3, 5, 8, 13) and free numeric entry. Estimates on subtasks are optional and are not double-counted with their parent

**Burndown and sprint report**

- A daily job (at each tenant's local midnight) writes a row to `sprint_snapshots` with total and remaining points
- The sprint page shows a burndown chart: ideal line against actual remaining points, with markers where scope changed
- A simple sprint report lists completed items, not-completed items, and items added after the sprint started
- Velocity, cumulative flow and other reports are out of scope for now

## 6. Work item detail view

The detail view opens as a side panel from the board or backlog, and as a full page at its own URL (`/spaces/ENG/items/ENG-142`) for sharing. Both render the same component.

**Layout:** a two-column layout. The main column holds the content, and a narrow right column holds the fields.

**Main column**

- Editable title, and a type icon that opens a type change menu
- Rich-text description (Tiptap) with headings, lists, code, tables, checklists, and @mentions of members. Autosaves, and shows a clear saved state
- Subtasks list with inline create, status toggles, and a progress bar
- Linked items (blocks, relates to, duplicates) with an add-link picker that searches by key or title
- Attachments: drag-and-drop upload, image previews, file size limits per plan, tenant-scoped storage keys
- Tabs: **Comments**, **Activity** (full history with old and new values), and **Watchers**

**Right column fields**

- Status (dropdown limited to the space's statuses), assignee, reporter, priority, estimate, due date, labels, parent epic, sprint (Scrum spaces), created and updated timestamps
- Fields save on change with optimistic updates. Everything is inline-editable

**Comments**

- Rich text with @mentions. Edit and delete by the author, and delete by space admins. Deleted comments are soft-deleted and leave a visible marker
- Each mention creates a notification and adds the person as a watcher

**Activity and history**

- Every field change, status move, assignment, comment, attachment and link is an `activity_event`. The Activity tab shows a readable timeline, for example "Sam moved this from In Progress to In Review"

**Other behaviors**

- Watch and unwatch, copy link, copy key, duplicate, move to another space (keeps history, assigns a new key), and delete (soft)
- Reporter and the first assignee are watchers automatically
- Keyboard shortcuts: `A` assign, `L` label, `M` comment, `Esc` close the panel
- Required: unsaved-change protection, optimistic concurrency (a stale edit shows a "changed by someone else" prompt), and clear permission-denied states for viewers

## 7. Permissions, tenancy and notifications

**Permissions** reuse the foundation's roles. Org owners and org admins act as space admins in every space of their tenant. Add every action below to the single `can(user, action, resource)` module, and enforce it in the API.

| Action                                                  | Space admin | Space member       | Space viewer |
| ------------------------------------------------------- | ----------- | ------------------ | ------------ |
| View board, backlog, items, comments                    | Yes         | Yes                | Yes          |
| Create items                                            | Yes         | Yes                | No           |
| Edit items, move cards, assign                          | Yes         | Yes                | No           |
| Delete items                                            | Yes         | Own reported items | No           |
| Comment                                                 | Yes         | Yes                | No           |
| Edit or delete own comments                             | Yes         | Yes                | n/a          |
| Delete others' comments                                 | Yes         | No                 | No           |
| Create labels                                           | Yes         | Yes                | No           |
| Create sprints                                          | Yes         | Yes                | No           |
| Start and complete sprints                              | Yes         | No                 | No           |
| Manage statuses, WIP limits, board settings, board type | Yes         | No                 | No           |
| Create personal saved filters                           | Yes         | Yes                | Yes          |
| Create filters shared with the space                    | Yes         | Yes                | No           |

**Multi-tenancy rules specific to this module**

- Every table in section 2 carries `org_id` with row-level security, following the foundation brief
- Cross-space search and the "my items" views are filtered by the user's effective space access in the database query, never after the fact in application code
- Attachment storage keys start with the tenant id, and download links are short-lived signed URLs that are checked against tenant and space access
- Item keys are unique per space, and space keys are unique per tenant, so two tenants can both have an `ENG` space
- Background jobs (burndown snapshots, rank rebalancing, due-date reminders, email) carry `org_id` and set tenant context before touching data
- Add cross-tenant tests for items, comments, attachments, filters and search

**Notifications**

- Events that notify: assigned to you, @mentioned, new comment on an item you watch, status change on an item you reported or are assigned, due date within 24 hours (daily job), sprint started or completed in a space you belong to
- Channels: an in-app bell with an unread count and an inbox page, plus email through the platform's queued SendGrid delivery
- Per-user preferences by event type and channel, plus an optional daily email digest
- Never notify people about their own actions. Batch rapid email events (for example a five-minute window) to avoid floods
- Viewers are notified only for mentions and watched items

## 8. UI requirements

The module must look and feel like a mature product (Jira, Linear), inside the app shell, sidebar and design system from the foundation brief. Reuse the shared components and the `/design` page; add new shared components there first.

**Navigation:** each space expands in the sidebar into Board, Backlog (Scrum spaces only), List, Reports and Settings. The space header repeats these as tabs, with the space icon, key and a members avatar stack.

**Screens**

| Screen          | What it contains                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Board           | Filter bar, swimlanes, columns with WIP counts, draggable cards, inline create, side panel for the open item             |
| Backlog         | Sprint sections and backlog list, epics panel, drag between sections, start and complete sprint actions                  |
| Work item       | Side panel and full page: description, subtasks, links, attachments, comments, activity, right-hand fields               |
| List            | Data table of all items in the space: sortable, column picker, filters, bulk actions, CSV export                         |
| Create item     | Dialog with grouped fields (core, planning, relations), type tabs, and a "create another" switch                         |
| Complete sprint | Three-step dialog: summary, where unfinished items go, confirm                                                           |
| Epics           | Epic list with progress bars, expandable to child items                                                                  |
| Reports         | Burndown chart and sprint report with a sprint selector                                                                  |
| Board settings  | Status editor with drag-reorder, categories, colors and WIP limits; swimlane mode; card fields; board type               |
| My work         | Cross-space view of items assigned to or reported by me, grouped by space or status, plus saved filters                  |
| Notifications   | Inbox with unread filter, mark all read, and preferences                                                                 |
| Search          | Command palette (Ctrl/Cmd+K) matches item keys and titles across accessible spaces, and a full results page with filters |

**Components (shadcn/ui first)**

- Layout and structure: `Sheet` (item panel), `ResizablePanel` (backlog and detail), `Tabs`, `Breadcrumb`, `ScrollArea`, `Separator`, `Card`
- Inputs: `Command` and `Popover` for searchable pickers, `Select`, `Calendar` date picker, `ToggleGroup`, `Checkbox`, `Switch`
- Data: `Table` with TanStack Table, TanStack Virtual for long lists, `Badge`, `Avatar` (with stack), `Progress`, `Skeleton`, `Chart` for the burndown
- Feedback: `Sonner` toasts, `AlertDialog` for destructive actions, `Tooltip`, `DropdownMenu` and `ContextMenu` for card actions
- Outside shadcn: dnd-kit for drag and drop, Tiptap for rich text, fractional-indexing for ranks

**Visual language**

- Distinct, consistent icons and colors for the five item types and five priorities (Highest, High, Medium, Low, Lowest), reused on the board, list and pickers
- Status chips and column accents colored by category (To do, In progress, Done), and never by color alone: always an icon or label too
- Cards are compact, with a subtle border, a hover lift, a clear drag state (slight rotation and shadow), and a visible drop indicator
- Density toggle: comfortable and compact, remembered per user

**Interaction and performance**

- Optimistic updates everywhere, with rollback and a toast on failure
- Columns load 50 cards at a time with "load more", and the list view is virtualized. The board must stay smooth with 500 items
- Keyboard: a shortcuts overlay (`?`), board navigation with arrow keys, `C` create, `/` focus search
- Responsive: on tablet the side panel overlays the board, and on mobile columns snap-scroll horizontally and the item view is a full-screen sheet

**Quality bar:** loading skeletons shaped like the final content, helpful empty states for each screen (for example an empty board with a call to create the first item), friendly error states, WCAG AA contrast, visible focus, and no layout shift when cards load or move.

## 9. API outline

REST under `/api/v1`, following the conventions of the foundation brief (zod validation, cookie sessions, `can()` on every route, consistent error shape). Items can be addressed by id or by key (`ENG-142`).

| Resource           | Endpoints                                                                                                                                                             | Phase |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Statuses           | `GET /spaces/:id/statuses`, `POST /spaces/:id/statuses`, `PATCH /statuses/:id`, `DELETE /statuses/:id?replace_with=`, `PUT /spaces/:id/statuses/order`                | W1    |
| Board              | `GET /spaces/:id/board` (columns with items, filters, per-column cursor), `PATCH /boards/:id` (settings)                                                              | W1    |
| Work items         | `GET /spaces/:id/items`, `POST /spaces/:id/items`, `GET /items/:ref`, `PATCH /items/:id` (`If-Match`), `DELETE /items/:id`, `GET /items/:id/subtasks`                 | W1    |
| Move               | `POST /items/:id/move` (status, `before_item_id` or `after_item_id`, swimlane value, sprint)                                                                          | W2    |
| Bulk               | `POST /items/bulk` (move, assign, label, delete)                                                                                                                      | W2    |
| Labels             | `GET/POST /spaces/:id/labels`, `PATCH/DELETE /labels/:id`                                                                                                             | W2    |
| Comments           | `GET/POST /items/:id/comments`, `PATCH/DELETE /comments/:id`                                                                                                          | W3    |
| Attachments        | `POST /items/:id/attachments` (signed upload), `GET /attachments/:id` (signed download), `DELETE /attachments/:id`                                                    | W3    |
| Links and watchers | `POST /items/:id/links`, `DELETE /links/:id`, `PUT/DELETE /items/:id/watch`                                                                                           | W3    |
| Activity           | `GET /items/:id/activity`                                                                                                                                             | W3    |
| Item actions       | `POST /items/:id/duplicate`, `POST /items/:id/transfer` (to another space)                                                                                            | W3    |
| Search and filters | `GET /search`, `GET/POST /filters`, `PATCH/DELETE /filters/:id`, `GET /me/items`                                                                                      | W4    |
| Epics              | `GET /spaces/:id/epics` (with child counts and progress)                                                                                                              | W4    |
| Notifications      | `GET /notifications`, `POST /notifications/read`, `GET/PUT /me/notification-preferences`                                                                              | W5    |
| Backlog            | `GET /spaces/:id/backlog` (sprint sections and unsprinted items)                                                                                                      | W6    |
| Sprints            | `GET/POST /spaces/:id/sprints`, `PATCH /sprints/:id`, `POST /sprints/:id/start`, `POST /sprints/:id/complete`, `GET /sprints/:id/report`, `GET /sprints/:id/burndown` | W6    |
| Live events        | `GET /spaces/:id/events` (server-sent events)                                                                                                                         | W7    |

**Conventions**

- List endpoints use cursor pagination and the same filter query parameters as the UI (`assignee`, `type`, `priority`, `label`, `epic`, `status`, `due`, `q`)
- Mutations on items require `If-Match` with the item's `updated_at`, and return `412` on a stale write
- The move endpoint returns the item with its new rank, so the client can reconcile its optimistic state
- Every mutation writes an `activity_event` and, where relevant, enqueues notification jobs

## 10. Phased build plan

Seven phases, labeled W1 to W7 so they do not clash with the foundation brief's phases. **Prerequisite:** foundation Phases 0 to 5 are complete (tenants, auth, members, groups, spaces, space roles, audit log). Do not start a phase until the previous one meets its done criteria.

### W1: Statuses, items and a read-only board

- Migrations for the core tables in section 2, with row-level security and tenant-isolation tests
- Default statuses created with every new space, and a board type (Kanban or Scrum) chosen at space creation, with the create-space form updated
- Work item create, read, update and soft-delete, with sequential keys, type rules and hierarchy validation
- Board endpoint and UI: columns, cards, empty states, and a basic item side panel with editable core fields
- Status editor in board settings (add, rename, reorder, recolor, delete with replacement)
- New permissions added to `can()` with allowed and denied tests
- **Done when:** a member can create items, see them in the right columns of the space board, keys are sequential per space, and tenant isolation tests pass

### W2: Drag and drop and board power features

- Move endpoint with fractional ranks and version checks, and dnd-kit with optimistic updates and keyboard support
- Inline create per column, filter bar with URL state, quick filters, swimlanes, WIP limit warnings, card field settings, labels and bulk actions
- **Done when:** two people can move and reorder cards at the same time without lost updates, and a board with 500 items stays smooth

### W3: Work item depth

- Rich-text description, subtasks, comments with mentions, attachments with signed URLs, links, watchers, activity timeline, duplicate and transfer to another space
- **Done when:** the detail view matches section 6 and every action has permission and tenant tests

### W4: Search, list view and epics

- List view with TanStack Table, saved filters, global search and command palette integration, My work, and the epics page with progress
- **Done when:** a user finds any item they can access by key or text quickly, and results never include other tenants or inaccessible spaces

### W5: Notifications

- Notification events, in-app inbox with unread counts, email through the queued SendGrid delivery, per-user preferences, due-date reminder job, and batching
- **Done when:** assignments, mentions, comments and status changes notify the right people on the right channels, and never the person who caused them

### W6: Backlog and sprints (Scrum)

- Backlog view, sprint create, edit, start and complete flows, `sprint_items_history`, daily snapshot job, burndown and sprint report
- Rules for switching board type (a space with an active sprint must complete it first)
- **Done when:** a full sprint can be planned, run and completed with carry-over, and the burndown matches the recorded history

### W7: Live updates and hardening

- Server-sent events for live board and item updates, scoped by tenant and space access
- Accessibility and keyboard pass, query and index review for N+1 problems, virtualization checks, demo seed data
- Playwright end-to-end tests: create item, drag across columns, comment with mention, run a sprint, and a cross-tenant attack attempt
- **Done when:** the end-to-end suite passes in CI, and two browsers see each other's moves within about a second

## 11. Definition of done and open decisions

Every phase is done only when all of the following hold.

- Lint, type-check and tests pass in CI
- New endpoints have permission tests (allowed and denied) and cross-tenant tests
- New screens have loading, empty and error states, work with the keyboard, and appear on the `/design` page where they add shared components
- Migrations are reversible and the demo seed data still works
- `CHANGELOG.md` and `DECISIONS.md` are updated

**Open decisions to settle before W1**

- [ ] File storage for attachments: S3-compatible bucket, or storage on an existing VM
- [ ] Rich-text editor: Tiptap (assumed) or another
- [ ] Should members or only admins be able to delete items? (assumed: members delete only items they reported)
- [ ] Should Kanban spaces get optional sprints later, or stay strictly continuous flow?
- [ ] Epics on the board: hidden (assumed), or optionally shown as a lane
- [ ] Estimate unit: story points only (assumed), or also hours
- [ ] Item types: keep the fixed five, or allow tenants to define their own later
- [ ] Real-time transport: server-sent events (assumed) or WebSockets

## 12. Prompts to give Claude

Save this brief as `docs/WORK-ITEMS-BRIEF.md` next to the foundation brief, then paste the kickoff prompt into Claude Code. Use the board UI prompt alongside it, or save it as `docs/BOARD-UI.md`.

### Kickoff prompt

```markdown
You are the lead engineer extending our multi-tenant company platform with a work management module: work items, Kanban boards, backlog and sprints.

Read docs/BRIEF.md (the foundation brief) and docs/WORK-ITEMS-BRIEF.md fully before doing anything. The foundation brief's rules, tech stack, multi-tenancy model, permission module and design system apply to this module unchanged.

Rules:

- Confirm that foundation Phases 0 to 5 are complete. If not, stop and tell me what is missing.
- Build one phase at a time (W1 to W7), in order. Do not start a phase until the previous one meets its done criteria.
- Respect the non-goals in section 1 of the work items brief. If something is not in the brief, ask before adding it.
- Every new table carries org_id and row-level security. Every module ships with cross-tenant isolation tests.
- Add every new action to the single can(user, action, resource) module and enforce it in the API. The UI only mirrors it.
- Use shadcn/ui, dnd-kit, Tiptap, TanStack Query and Table. Reuse shared components, and add new shared components to the /design page first.
- Before writing code for a phase, reply with a short plan: migrations, endpoints, screens, risks. Wait for my approval.
- Small commits. Run lint, type-check and tests before saying a task is done. Update docs/CHANGELOG.md and docs/DECISIONS.md.
- When the brief is ambiguous, list the options with a recommendation and ask.

Start with W1. First list any open decisions from section 11 that block it, then give me the W1 plan.
```

### Board UI prompt

```markdown
Build the board and work item screens to the quality of Jira and Linear: fast, dense, calm, and satisfying to use. This is the most used part of the product, so polish matters more here than anywhere else.

Board

- Columns with sticky headers showing status name, count and WIP usage. Columns scroll independently. Horizontal scroll on the board. Collapsible columns.
- Compact cards: key, title (max two lines), type and priority icons, assignee avatar, estimate, up to two labels plus a count, due date (red when overdue), epic chip, subtask progress, comment and attachment counts.
- Dragging: the card lifts with a slight rotation and soft shadow, a clear insertion line shows where it will land, columns highlight as valid targets, and dropping animates in under 200ms. Support keyboard dragging with screen-reader announcements.
- Filter bar above the board: search, assignee avatars, type, priority, label, epic, due date, quick filters, and a saved filters menu. Active filters show as removable chips.
- Inline create at the bottom of every column. Enter creates, Shift+Enter keeps going.
- Swimlanes with collapsible headers and counts.

Work item panel

- Opens as a right-side sheet that keeps the board visible, and as a full page at its own URL.
- Two columns: title, rich-text description, subtasks, links, attachments and tabs for Comments, Activity and Watchers on the left; a compact fields column on the right. All fields edit inline with optimistic updates and a subtle saved indicator.

Backlog

- Sprint sections with headers showing dates, item counts and points, drag between sections, an epics panel on the left, and a clear Start sprint and Complete sprint action.

Visual language

- Distinct, consistent icons and colors for the five item types and five priorities. Status colors by category, always paired with a label or icon.
- Neutral palette with the tenant accent used sparingly. Light and dark themes. 14px base text, 13px in dense areas. Comfortable and compact density toggle.

Quality

- Skeletons shaped like the final content, helpful empty states, friendly errors, visible focus, WCAG AA contrast, keyboard shortcuts with a ? overlay.
- Stay smooth with 500 items on a board: load 50 cards per column, virtualize long lists, avoid unnecessary re-renders.
- Mobile: columns snap-scroll, and the item view is a full-screen sheet.

Before building the full screens, add the card, column, filter bar, item panel skeleton and sprint header to the /design page in both themes, and get my approval of them.
```
