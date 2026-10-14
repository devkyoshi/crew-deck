# Missing features

What is suggested to teams but not built yet, and what is only partly built. This list is the backlog
to start from. The sign-up wizard asks **"What kind of work do you do?"** and **"How does your team plan to
use it?"**; every option marked *Coming soon* there is listed here. The source of truth for the options
is `packages/shared/src/workspace.ts` (`USAGE_OPTIONS`, `WORKSPACE_TEMPLATES`): an option with
`status: 'planned'` is not built.

Last reviewed: 2026-10-14.

## 1. What each kind of work needs

Legend: **Built** works today. **Partial** works but with a gap. **Missing** is not built.

| Kind of work | What the template turns on today | What the team expects | Status of the gaps |
| --- | --- | --- | --- |
| Software development | Board (To Do, In Progress, In Review, Done), bugs, epics, check-in | Sprints and backlog, Scrum board, burndown, dependency links, releases | Sprints **Missing** (W6), dependencies **Missing**, releases **Missing** |
| Product management | Board (Ideas, Planned, Building, Shipped) | Roadmap or timeline, prioritisation views, feedback intake | Roadmap **Missing**, list view **Missing** (W4) |
| Marketing | Board (Ideas, Drafting, Review, Published), CRM | Content calendar, approvals, asset library | Calendar **Missing**, approvals **Missing**, attachments **Built**, asset library **Missing** |
| Design | Board (Requested, Designing, Review, Approved) | Review and approval rounds, file attachments, comments on work | Approvals **Missing**, attachments and comments **Built** |
| Project management | Board, check-in | Dependencies, timeline or Gantt, checklists, milestones | All **Missing** |
| Operations | Board (Backlog, Doing, Blocked, Done), check-in | Recurring tasks, checklists, approvals | All **Missing** |
| IT support | Board (Open, In Progress, Waiting, Resolved) | Request queue with SLAs, request forms, email intake, knowledge base | All **Missing** |
| Human resources | Board, check-in | Onboarding checklists, leave requests and approval, documents | Checklists **Missing**; leave is only *planned location = leave* in check-in (**Partial**) |
| Customer service | Board (New, Working, Waiting on customer, Resolved), CRM | Ticket queue, SLAs, customer portal, email intake | All **Missing**; the CRM covers contacts and companies (**Built**) |
| Legal | Board (Intake, In Review, With counterparty, Signed) | Matters, document versions, approvals, e-signature | All **Missing** |
| Finance | Board (Requested, Reviewing, Approved, Paid) | Spend approvals with limits, attachments (receipts), export | Attachments **Built**; approvals and export **Missing** |
| Sales | Board (To Do, Following up, Done), CRM | Leads, contacts, companies, deals pipeline, activities, import and export | **Built**; forecasting and email sync **Missing** |
| Data science | Board (Backlog, Exploring, Validating, Shipped) | Experiment tracking, attachments, notebooks links | **Missing** beyond the board |
| Construction | Board (Planned, On site, Inspection, Complete), check-in with sites | Jobs and sites, crew attendance, punch lists, inspections, RFIs, daily site logs, photos, subcontractors | Sites, attendance and photos on jobs **Built**; punch lists use bug items (**Partial**); inspections, RFIs, daily logs and subcontractor access **Missing** |
| Other | Board, check-in | Depends on the team | — |

## 2. Usage options marked *Coming soon*

| Option (key) | What it needs to be real | Related plan gate |
| --- | --- | --- |
| Run sprints (`run_sprints`) | **Built** (backlog, sprints, reports); offered as ready at sign-up | `scrum_sprints` |
| Work in scrum (`work_in_scrum`) | **Built** (Scrum board type, burndown); offered as ready at sign-up | `scrum_sprints`, `burndown_reports` |
| Map work dependencies (`map_dependencies`) | Links ("blocks / is blocked by") are **Built** on the item page and offered as ready at sign-up; still missing: showing them on cards and warning when a blocked item moves | — |
| Plan a roadmap (`roadmap`) | Timeline of epics with dates | — |
| Content calendar (`content_calendar`) | Calendar view of items by due date | — |
| Run approvals (`approvals`) | Approval step on an item or a request, with approver, decision and trail | — |
| Handle requests and tickets (`service_requests`) | Request queue, request types and forms, SLAs, email intake | — |
| Use checklists (`checklists`) | Checklists inside descriptions and comments are **Built** (rich text); missing: checklist progress on cards and reusable checklist templates | — |
| Store documents (`documents`) | Attachments on items and storage limits are **Built**; missing: a documents library, versions and object storage (S3) | `max_attachment_mb`, `storage_mb` |

## 3. Work management: built, with these gaps

All seven phases in [work-items/PHASES.md](work-items/PHASES.md) are built. Known gaps:

- **Backlog ordering.** Work can be moved between the backlog and sprints, but not reordered within a
  section (it follows the board's rank).
- **List view** pages with Show more rather than a virtualised table; CSV export is capped at 5,000 rows.
- **Search** covers item titles and descriptions, not comments or attachment names.
- **Notifications** have no daily digest option and no push notifications; emails need a Brevo key.
- **Sprints:** no sprint velocity or cumulative flow reports, no Kanban sprints (out of scope in the brief).
- **Live updates** refresh whole screens of a space; there are no "someone is editing" indicators.
- **Moved items** keep their history, but the old key does not redirect to the new one.

## 4. Platform features not built

- Payments and billing (plans are display-only; the platform console changes them by hand).
- Custom domains per workspace.
- Per-workspace SSO (SAML, Azure AD). Only Google sign-in exists.
- Chat.
- A workspace template gallery beyond the starter space and labels (sample items, saved views per type).
- Per-type language outside the work screens (navigation, notifications, emails still say "space" and "item"
  in places), and custom words chosen by the workspace instead of the template's.
- Restricting item types in the API. Templates limit which types the UI offers, but the API accepts all five,
  so changing the kind of work never strands existing items.
- Leaving a workspace or transferring ownership yourself.

## 5. Partly built or known gaps

- **Work item depth (W3)** gaps: no notifications yet for mentions or watched items (W5); the old key of a
  moved item does not redirect to the new one; files are kept on local disk only (an S3 driver can slot
  into `StorageDriver`); no virus scanning beyond refusing programs and scripts; the link picker searches
  the current space (other spaces by typing a key); deleted items keep their attachments on disk.

- **Work-item limit upgrade notice** in the UI is still pending (the API answers 402 correctly).
- **A space can end up with no active admin** through indirect changes (for example deleting its only
  admin group). Workspace admins can repair it from the space's Members tab.
- **Google sign-in and Brevo email** are covered by tests with fakes but not exercised against the real
  services.
- **Database-level integrity.** Since the move to MongoDB there are no foreign keys or check constraints:
  same-tenant links, valid statuses, time ordering on check-ins and similar rules are enforced by the API
  and its tests. Unique indexes still protect keys, item numbers and pending requests.
- **Stale documents.** `docs/BRIEF.md` and the Phase 1 brief describe the original Postgres design;
  they are kept as the historical brief. ADR numbers 041 to 049 appear twice in `docs/DECISIONS.md`.
