# Crew Deck: pricing and plans

Prices are display-only until payments are added (there is no payment integration yet). Prices are per seat per month, billed annually; the monthly-billing surcharge is still to be decided. Feature keys match [FEATURES.md](FEATURES.md).

|                                                                    | Free             | Team           | Business                      |
| ------------------------------------------------------------------ | ---------------- | -------------- | ----------------------------- |
| **Price**                                                          | $0               | $6 / seat      | $12 / seat                    |
| Trial                                                              | n/a              | n/a            | 14 days on sign-up, then Free |
| **Seats** (`seats`)                                                | 5                | 50             | Unlimited                     |
| **Spaces** (`spaces`)                                              | 3                | Unlimited      | Unlimited                     |
| **Work items** (`work_items`)                                      | 250              | Unlimited      | Unlimited                     |
| **Storage** (`storage_mb`)                                         | 100 MB           | 5 GB           | 50 GB                         |
| **Audit log history** (`audit_days`)                               | 30 days          | 1 year         | Full                          |
| Members, groups, access requests                                   | Yes              | Yes            | Yes                           |
| Google and password sign-in                                        | Yes              | Yes            | Yes                           |
| Check-in, team board, my day                                       | Yes              | Yes            | Yes                           |
| Sites and holidays (`sites`)                                       | 1 site           | Unlimited      | Unlimited                     |
| Attendance reports and CSV export (`attendance_export`)            | No               | Yes            | Yes                           |
| CRM: leads, contacts, companies, deals, activities (`crm_records`) | Yes, 500 records | Yes, unlimited | Yes, unlimited                |
| CRM pipelines (`pipelines`)                                        | 1                | 3              | Unlimited                     |
| CRM CSV import and export (`crm_io`)                               | No               | Yes            | Yes                           |
| Domain-restricted invites (`domain_lock`)                          | No               | Yes            | Yes                           |
| Per-space audit log (`space_audit`)                                | No               | No             | Yes                           |
| Branding (`branding`)                                              | No               | Name only      | Logo and accent colour        |
| Support                                                            | Community        | Email          | Priority                      |

**Enterprise** is "contact us": custom limits set by a platform admin.

## Rules

- A limit stops you adding more (for example a sixth person on Free). It never deletes or hides existing data.
- A locked feature becomes read-only with an upgrade prompt. Data created while on a higher plan is kept and stays readable after a downgrade.
- A trial runs for 14 days from sign-up on the Business plan. When it ends, the workspace moves to Free automatically and the owner is told.
- Seats count active members (invited, not yet accepted, count as well so the limit cannot be bypassed by sending many invitations).
- Platform admins can change a workspace's plan, extend its trial and set custom limits.

## Work management limits

Proposed for the work items module; details, behaviour and wiring are in [work-items/PRICING-GATES.md](work-items/PRICING-GATES.md). Work items (`work_items`) is live since W1. The rest are added to the table above when the matching phase ships (attachments W3, shared filters W4, Scrum and burndown W6).

|                                                        | Free  | Team      | Business  |
| ------------------------------------------------------ | ----- | --------- | --------- |
| **Max attachment size** (`max_attachment_mb`)          | 5 MB  | 25 MB     | 100 MB    |
| Scrum backlog and sprints (`scrum_sprints`)            | No    | Yes       | Yes       |
| Filters shared with the space (`shared_filters`)       | No    | Yes       | Yes       |
| Roadmap timeline (`roadmap`)                             | No    | Yes       | Yes       |
| Flow reports (`advanced_reports`)                        | No    | No        | Yes       |
| Releases: versions and release notes (`releases`)        | No    | Yes       | Yes       |
| Burndown and sprint report (`burndown_reports`)        | No    | No        | Yes       |

## Messaging limits

Enforced in the API since M5. A limit stops new things; it never deletes. Numbers are the shipped defaults and can be changed per workspace by a platform admin.

|                                                  | Free    | Team     | Business  |
| ------------------------------------------------ | ------- | -------- | --------- |
| **Channels** people made (`channels`)            | 10      | 200      | Unlimited |
| **Message history shown** (`message_history_days`) | 90 days | 2 years  | Unlimited |

Direct messages and a space's own channel do not count toward `channels`. Older messages past the history window are kept and show again if the plan grows; they are hidden from the conversation and from search. File storage and attachment size reuse `storage_mb` and `max_attachment_mb`.

Kanban boards, statuses, comments, links and search are included in every plan. Storage (`storage_mb`) is enforced since W3, and deleting an item frees its files. The pricing page and plan comparison list all of these since W8.
