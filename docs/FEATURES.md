# Crew Deck: feature catalogue

Every feature in the product, by area. **Status:** Built = in the app today; Planned = not built yet. **Gate** is the stable key used by the plan system (see [PRICING.md](PRICING.md)); a blank gate means every plan has the feature. The plan definitions in the database use these same keys.

## Workspace and identity

| Feature                                                                                | Status | Gate                             |
| -------------------------------------------------------------------------------------- | ------ | -------------------------------- |
| Multi-tenant workspaces on subdomains, data isolated per company (row-level security)  | Built  |                                  |
| Sign in with email and password                                                        | Built  |                                  |
| Sign in with Google                                                                    | Built  |                                  |
| Invite people by email, accept link, join groups on accept                             | Built  | `seats` limit                    |
| Domain-restricted invites (only the company email domain)                              | Built  | `domain_lock`                    |
| Members directory: search, filter, sort, profiles, job title, timezone, manager        | Built  |                                  |
| Roles: owner, admin, member; deactivate and reactivate per workspace; last-owner guard | Built  |                                  |
| Command palette (Ctrl+K), light and dark theme, keyboard and screen-reader support     | Built  |                                  |
| Audit log: who did what, filters, details                                              | Built  | `audit_days`                     |
| Self-serve company sign-up with email verification                                     | Built  |                                  |
| Branding: name, logo, accent colour                                                    | Built  | `branding_name`, `branding_full` |
| Plan, trial and usage page; upgrade prompts                                            | Built  |                                  |

## Groups and spaces

| Feature                                                                      | Status | Gate          |
| ---------------------------------------------------------------------------- | ------ | ------------- |
| Groups (teams) with members and descriptions                                 | Built  |               |
| Spaces with unique keys, icons, open or private visibility                   | Built  | `spaces`      |
| Space roles (admin, member, viewer) for people and groups; highest role wins | Built  |               |
| Access requests: request, approve with a role, decline, cancel               | Built  |               |
| Archive, restore and delete spaces; starred and recent spaces                | Built  |               |
| Per-space audit log                                                          | Built  | `space_audit` |

## Check-in and attendance

| Feature                                                             | Status | Gate                |
| ------------------------------------------------------------------- | ------ | ------------------- |
| Check in and out with location (onsite, remote, offsite) and notes  | Built  |                     |
| Weekly plan, leave, history, corrections with a mandatory reason    | Built  |                     |
| Team board with live status (teammates see status, not exact times) | Built  |                     |
| Auto-close of forgotten check-outs in each person's timezone        | Built  |                     |
| Work hours settings, sites, holidays                                | Built  | `sites`             |
| Attendance reports and CSV export                                   | Built  | `attendance_export` |

## CRM

| Feature                                                                    | Status | Gate          |
| -------------------------------------------------------------------------- | ------ | ------------- |
| Leads, contacts, companies with search, filters, tags and owners           | Built  | `crm_records` |
| Lead conversion into company, contact and deal                             | Built  |               |
| Deals board (drag and drop, keyboard, totals per currency) and table       | Built  |               |
| Pipelines and stages (custom, reorderable)                                 | Built  | `pipelines`   |
| Activities (call, meeting, email, task), overdue view, notes with mentions | Built  |               |
| CRM dashboard                                                              | Built  |               |
| CSV import (with dry run) and export                                       | Built  | `crm_io`      |
| CRM roles per member (none, viewer, member, admin); module on or off       | Built  |               |

## Platform

| Feature                                                               | Status | Gate |
| --------------------------------------------------------------------- | ------ | ---- |
| Platform admin console: tenants, suspend, plan, trial, usage          | Built  |      |
| Read-only, audited impersonation                                      | Built  |      |
| Platform settings (for example block free email providers at sign-up) | Built  |      |

## Work management (planned, see docs/work-items)

| Feature                                                              | Status  | Gate               |
| -------------------------------------------------------------------- | ------- | ------------------ |
| Work items, hierarchy, statuses, Kanban board with inline create, side panel, board settings (W1) | Built | `work_items` |
| Drag and drop between columns, keyboard and touch (W2)               | Built   |                    |
| Filters in the URL, swimlanes, labels, bulk actions, shortcuts (W2)  | Built   |                    |
| Rich text, comments, mentions, attachments, links, activity (W3)     | Built   | `max_attachment_mb`, `storage_mb` |
| Watchers, duplicate an item, move an item to another space (W3)      | Built   | `work_items`       |
| List view, epics, search, My work, saved filters (W4)                | Planned | `shared_filters`   |
| Notifications: in-app, email, preferences (W5)                       | Planned |                    |
| Backlog and sprints (Scrum) (W6)                                     | Planned | `scrum_sprints`    |
| Burndown and sprint report (W6)                                      | Planned | `burndown_reports` |
| Live updates (W7)                                                    | Planned |                    |

## Workspaces and templates

| Feature                                                                 | Status  | Gate |
| ----------------------------------------------------------------------- | ------- | ---- |
| One account in several workspaces, switcher, "Your workspaces" page      | Built   |      |
| Create another workspace while signed in                                 | Built   |      |
| "What kind of work do you do?" and "How will you use it?" at sign-up     | Built   |      |
| Templates: modules and starting columns per kind of work                 | Built   |      |
| Change the kind of work later (Settings, Kind of work)                   | Built   |      |
| The team's own words for work (job, ticket, case) and item types         | Built   |      |
| A first space with columns and labels for a new workspace                | Built   |      |
| Switch to another workspace without signing in again                     | Built   |      |
| Type-specific modules (ticket queues, punch lists, approvals, calendar)  | Planned |      |

## Not built yet

Chat, payments, custom domains, per-tenant SSO, the planned work management phases above, and the
type-specific modules. The full list is in [MISSING-FEATURES.md](MISSING-FEATURES.md).
