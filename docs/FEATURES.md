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

## Not built yet

Work items and boards, chat, file storage, notifications, payments, custom domains, per-tenant SSO.
