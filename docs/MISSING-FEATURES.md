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
| Marketing | Board (Ideas, Drafting, Review, Published), CRM | Content calendar, approvals, asset library | Calendar **Missing**, approvals **Missing**, attachments **Missing** (W3) |
| Design | Board (Requested, Designing, Review, Approved) | Review and approval rounds, file attachments, comments on work | Approvals **Missing**, attachments and comments **Missing** (W3) |
| Project management | Board, check-in | Dependencies, timeline or Gantt, checklists, milestones | All **Missing** |
| Operations | Board (Backlog, Doing, Blocked, Done), check-in | Recurring tasks, checklists, approvals | All **Missing** |
| IT support | Board (Open, In Progress, Waiting, Resolved) | Request queue with SLAs, request forms, email intake, knowledge base | All **Missing** |
| Human resources | Board, check-in | Onboarding checklists, leave requests and approval, documents | Checklists **Missing**; leave is only *planned location = leave* in check-in (**Partial**) |
| Customer service | Board (New, Working, Waiting on customer, Resolved), CRM | Ticket queue, SLAs, customer portal, email intake | All **Missing**; the CRM covers contacts and companies (**Built**) |
| Legal | Board (Intake, In Review, With counterparty, Signed) | Matters, document versions, approvals, e-signature | All **Missing** |
| Finance | Board (Requested, Reviewing, Approved, Paid) | Spend approvals with limits, attachments (receipts), export | All **Missing** |
| Sales | Board (To Do, Following up, Done), CRM | Leads, contacts, companies, deals pipeline, activities, import and export | **Built**; forecasting and email sync **Missing** |
| Data science | Board (Backlog, Exploring, Validating, Shipped) | Experiment tracking, attachments, notebooks links | **Missing** beyond the board |
| Construction | Board (Planned, On site, Inspection, Complete), check-in with sites | Jobs and sites, crew attendance, punch lists, inspections, RFIs, daily site logs, photos, subcontractors | Sites and attendance **Built**; punch lists use bug items (**Partial**); inspections, RFIs, daily logs, photos and subcontractor access **Missing** |
| Other | Board, check-in | Depends on the team | — |

## 2. Usage options marked *Coming soon*

| Option (key) | What it needs to be real | Related plan gate |
| --- | --- | --- |
| Run sprints (`run_sprints`) | Backlog, sprint planning, start and complete sprint (W6) | `scrum_sprints` |
| Work in scrum (`work_in_scrum`) | Scrum board type (create-space wizard shows it as *Coming soon*), burndown (W6) | `scrum_sprints`, `burndown_reports` |
| Map work dependencies (`map_dependencies`) | "Blocks / is blocked by" links between items, shown on cards and the item page | — |
| Plan a roadmap (`roadmap`) | Timeline of epics with dates | — |
| Content calendar (`content_calendar`) | Calendar view of items by due date | — |
| Run approvals (`approvals`) | Approval step on an item or a request, with approver, decision and trail | — |
| Handle requests and tickets (`service_requests`) | Request queue, request types and forms, SLAs, email intake | — |
| Use checklists (`checklists`) | Checklist items inside a work item; reusable checklist templates | — |
| Store documents (`documents`) | Attachments on items (W3), storage limits | `max_attachment_mb`, `storage_mb` |

## 3. Work management phases not started

From [work-items/PHASES.md](work-items/PHASES.md):

- **W3** rich text, comments, mentions, attachments, links, activity history.
- **W4** list view, epics page, global search, My work, saved filters (`shared_filters`).
- **W5** notifications (in-app and email) and preferences.
- **W6** backlog and sprints, burndown and sprint report.
- **W7** live updates (server-sent events).

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

- **Scrum board type** is shown as *Coming soon* in the create-space wizard and refused by the API.
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
