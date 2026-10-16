# Jira Software parity

What a software team does daily in Jira Software, and where each thing lives in this application. Status: **Built** (works today), **Partial** (works with a stated gap), **Out of scope** (decided against, see the end). Plan gates are in `docs/PRICING.md`. Last reviewed: 2026-10-16 (after W14).

## Projects and boards

| Jira feature | Status | Where / notes |
| --- | --- | --- |
| Projects | Built | Spaces (Spaces > New space), with a key such as `ENG`; open or private; archive and restore |
| Kanban board | Built | Space > Board; columns are statuses, WIP limits, swimlanes, filters, drag and drop, keyboard moves |
| Scrum board and backlog | Built | Board type Scrum (new space or Board settings > Board type); Backlog tab (Team plan to start sprints) |
| Sprints (create, start, complete, carry over) | Built | Backlog tab; completing asks where unfinished work goes |
| Backlog ordering | Built | Drag within the backlog or a sprint; "Move to" menu |
| Sprint goal, dates | Built | Sprint edit dialog |
| Board settings (columns, card fields, swimlanes) | Built | Board > Board settings |
| Kanban without sprints | Built | Kanban spaces have no sprint concept; continuous flow with WIP limits |
| Done-work hiding | Built | Board settings > Finished work (hide after N days) |
| Multiple boards per project | Out of scope | One board per space; use filters and saved filters for other views |

## Work items

| Jira feature | Status | Where / notes |
| --- | --- | --- |
| Issue types: epic, story, task, bug, subtask | Built | Fixed five types (ADR-048); workspace can rename them for its own words |
| Custom issue types and fields | Out of scope | See below |
| Issue keys (`ENG-142`), links by key | Built | Item page `/spaces/ENG/items/ENG-142`; moved items keep answering to old keys |
| Priority, assignee, reporter, due date | Built | Item panel |
| Start date | Built | Item panel; used by the roadmap |
| Story points | Built | Item panel (half points) |
| Labels | Built | Item panel; per-space labels with colours |
| Components with default assignee | Built | Releases tab > Components |
| Fix version and affects version | Built | Item panel (affects version on bugs) |
| Description with rich text, mentions | Built | Tiptap editor, autosave |
| Comments, edit and delete own | Built | Item panel > Comments |
| Attachments | Built | Item panel; plan limits for size and total storage; local disk or S3 |
| Issue links (blocks, relates to, duplicates) | Built | Item panel > Linked items; badges on cards; warning when moving a blocked item |
| Subtasks with progress | Built | Item panel; progress on parent cards |
| Checklists | Built | Item panel > Checklist; templates per space |
| Resolution | Built | Item panel (Done, Won't do, Duplicate, Cannot reproduce) |
| Watchers | Built | Watch toggle; reporter, assignee, commenters and mentioned people watch automatically |
| Activity / history | Built | Item panel > Activity |
| Clone issue | Built | Item menu > Duplicate (copies subtasks, checklist, versions, components) |
| Move issue to another project | Built | Item menu > Move to another space; keeps history |
| Bulk change | Built | Select cards on the board or list; move, assign, label, delete |
| Time tracking: estimate, remaining, work log | Built | Item panel > Time tracking; roll-up on the roadmap |
| Timesheets across people | Partial | Work logs are per item; no cross-item timesheet report yet |
| Sub-issue conversion | Partial | Change the type in the item menu; parent rules apply |
| Voting | Out of scope | Not planned |

## Workflow

| Jira feature | Status | Where / notes |
| --- | --- | --- |
| Statuses with categories (to do, in progress, done) | Built | Board settings > Statuses; at least one per category |
| Transition rules (allowed moves) | Built | Board settings > Workflow rules |
| Transition screens, validators, post-functions | Out of scope | See below |
| Required resolution on Done | Partial | A resolution is always set (default Done) and can be changed; it is not forced to be chosen |
| Per-project workflow schemes | Partial | Each space has its own statuses and rules; no shared schemes |

## Finding and filtering

| Jira feature | Status | Where / notes |
| --- | --- | --- |
| Quick search, issue picker | Built | Ctrl/Cmd+K, `/` on boards |
| Full search page with filters | Built | Search page; searches titles, descriptions, comments and file names |
| Filters in the URL, saved filters, shared filters | Built | Filter bar; Saved menu (sharing needs Team plan) |
| JQL | Out of scope | Replaced by the filter bar and saved filters |
| List view with column picker, sorting, CSV export | Built | Space > List |
| My work (assigned, reported, watching) | Built | My work |
| Version and component filters, "blocked" filter | Built | Filter bar |

## Planning

| Jira feature | Status | Where / notes |
| --- | --- | --- |
| Releases (versions): create, release, notes | Built | Space > Releases (Team plan); unfinished work moves on at release |
| Release notes | Built | Releases > Notes (copy as text) |
| Roadmap / timeline | Built | Space > Roadmap (Team plan); drag, resize, keyboard, table |
| Calendar of due dates | Built | Space > Calendar |
| Epics with progress | Built | Space > Epics |
| Dependencies on the roadmap (lines between epics) | Partial | Links exist between items; the roadmap does not draw them |

## Reports and dashboards

| Jira feature | Status | Where / notes |
| --- | --- | --- |
| Burndown | Built | Reports > Sprint (Business plan) |
| Sprint report | Built | Reports > Sprint |
| Velocity | Built | Reports > Flow, Scrum spaces (Business plan) |
| Cumulative flow | Built | Reports > Flow (Business plan) |
| Control chart (cycle time) | Built | Reports > Flow, with average and 50/85/95 percent lines |
| Created vs resolved | Built | Reports > Flow |
| Dashboards with gadgets | Built | Dashboard: assigned to me, saved filter results, sprint health, release progress, created vs resolved |
| Dashboards shared with a team | Partial | Dashboards are personal; share through shared saved filters |

## Collaboration

| Jira feature | Status | Where / notes |
| --- | --- | --- |
| Notifications in app and by email | Built | Bell, Notifications page; choose per event type; daily summary option |
| Mentions | Built | `@` in descriptions and comments |
| Live board updates | Built | Server-sent events; boards, lists, backlogs and items refresh by themselves |
| Keyboard shortcuts | Built | `?` shows them: `C` create, `/` search, `M` comment, `A` assign, `L` labels, `T` status, `D` due date, `V` version |
| Documents / pages (Confluence) | Partial | Space > Documents: folders and files with drag and drop; no online page editor |

## Administration

| Jira feature | Status | Where / notes |
| --- | --- | --- |
| Roles per project (admin, member, viewer) | Built | Space > Members; groups can hold roles |
| Permission schemes | Partial | Fixed role matrix, tested; not configurable per space |
| Audit log | Built | Space and workspace audit log (Business plan for per-space) |
| Plans and limits | Built | Admin > Billing; usage meters |
| Single sign-on | Partial | Google sign-in only; SAML and Azure AD are not built |

## Out of scope for this module

Raise these as separate briefs if needed:

- **Jira Service Management:** request queues, SLAs, request forms, customer portal, email intake, approvals.
- **Custom fields and custom issue types**, field configuration, screens.
- **Automation rules** and workflow post-functions or validators.
- **A query language (JQL)** and advanced reports built on it.
- **Apps and marketplace**, webhooks, public API tokens.
- **Chat and wiki editing.**
