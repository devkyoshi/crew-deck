# Pricing gates for the work-items module

Status: **planned**, nothing here is live yet. It extends the Phase 9 plans (ADR-037 to ADR-040, `docs/PRICING.md`). Prices stay display-only; there is no payment integration.

## Principles (from ADR-037, keep them)

- Limits and features are checked on the server (`assertWithinLimit`, `assertFeature`); the UI only mirrors them (`useHasFeature`, `formatLimit`, `LockedButton`).
- A limit stops you adding more. It never deletes, hides or changes existing data. A locked feature becomes read-only with an upgrade prompt; data made on a higher plan stays readable after a downgrade.
- A workspace with no plan is "Internal" and unlimited. A finished trial counts as Free immediately (ADR-038).
- Platform admins can override any limit per workspace (number replaces, null lifts).
- Free must still be genuinely useful: every plan gets Kanban boards, statuses, comments, links and search. Paid plans add scale and Scrum.

## New keys

| Key | Kind | Free | Team | Business | Meaning |
| --- | --- | --- | --- | --- | --- |
| `work_items` | limit | 250 | Unlimited | Unlimited | Non-deleted work items in the workspace (all spaces). Soft-deleted items do not count |
| `max_attachment_mb` | limit | 5 | 25 | 100 | Largest single attachment |
| `storage_mb` | limit (exists, now enforced) | 100 | 5,120 | 51,200 | Total of non-deleted attachment sizes. Existing key; first enforced in W3 |
| `scrum_sprints` | feature | No | Yes | Yes | Create Scrum spaces, switch a board to Scrum, backlog and sprints |
| `shared_filters` | feature | No | Yes | Yes | Saved filters shared with the space (personal filters are free for all) |
| `burndown_reports` | feature | No | No | Yes | Burndown chart and sprint report |

Rationale: the item cap gives Free teams room to try the product (250 is several sprints of work for a small team) while the natural upgrade moment is when the board fills up. Scrum is the clearest value step between Free and Team. Reports are the Business differentiator, alongside per-space audit and full branding that already exist.

These numbers are proposals. The owner confirms them before `0011` is written; record the final values in `DECISIONS-PENDING.md` and ADR-047.

## Behaviour when limits or gates hit

| Situation | API | UI |
| --- | --- | --- |
| Create item at the `work_items` cap | `402 plan_limit` (`limit: work_items`, current, max) | Create dialog and inline create show a notice: "Your Free plan holds up to 250 work items. Upgrade to add more." with a link to `/admin/billing` (admins) or "Ask an admin" (others). Existing items stay fully editable |
| Duplicate, transfer in, bulk create | Same check, counting how many would be added | Same notice |
| Create a Scrum space / switch to Scrum | `402 feature_locked` (`scrum_sprints`) | Scrum option shows a lock chip and tooltip in the create-space wizard and board settings |
| Start a sprint on a plan that lost the feature | `402 feature_locked` | Start button shows `LockedButton`. Existing sprints and the board stay readable; the active sprint can still be **completed** so teams are never trapped |
| Upload over `max_attachment_mb` | `413` with the plan's max in the body, or `402 plan_limit` (decide in the W3 plan and keep consistent with ADR-037; recommended: `402 plan_limit` with `limit: max_attachment_mb`) | Drop zone rejects with the limit named, before upload when the size is known |
| Upload over `storage_mb` | `402 plan_limit` (`storage_mb`) | Notice with usage bar |
| Shared filter on Free | `402 feature_locked` (`shared_filters`) | "Share with space" toggle locked |
| Burndown on non-Business | `402 feature_locked` (`burndown_reports`) | Reports page shows the sprint list and report table; the chart area shows a locked preview with upgrade prompt |
| Downgrade with more items than the cap | Nothing is removed. Creating is refused until under the cap | Billing page shows usage above the cap in amber with an explanation |

## Wiring per phase

| Phase | Work |
| --- | --- |
| W1 | Migration `0011_plan_work_items` (up/down) updating seeded `plans` JSON with `work_items`, `max_attachment_mb` (Free 5, Team 25, Business 100), new feature keys. Add keys to `LIMIT_KEYS`/`FEATURE_KEYS`/`LIMIT_WORDS` in `apps/api/src/plans/index.ts`, add `countWorkItems(orgId)` (non-deleted rows; uses `withTenant`), include in the usage payload of `routes/plan.ts` and `/admin/billing`. `POST /spaces/:id/items` calls `assertWithinLimit('work_items')`. Mirror in `apps/web/src/lib/plans.ts`. Update `test/plans.test.ts` (seeded values, 402 at cap, override lifts cap, Internal unlimited) |
| W2 | Bulk and any copy path call `assertWithinLimit` with the count to be added |
| W3 | `max_attachment_mb` and `storage_mb` checks in the upload route (`countStorageMb`); duplicate and transfer respect `work_items`; usage bar on `/admin/billing` |
| W4 | `shared_filters` check on creating or updating a shared filter |
| W6 | `scrum_sprints` check on: creating a Scrum space, changing a board to Scrum, creating/starting sprints. `burndown_reports` check on `GET /sprints/:id/burndown` |
| Any | Keep `docs/PRICING.md`, `docs/FEATURES.md`, the pricing page and `plan-comparison.tsx` in step with what is actually enforced |

## Files to touch

API: `apps/api/src/plans/index.ts`, `apps/api/src/routes/plan.ts`, a new migration `0011_plan_work_items.{up,down}.sql`, `apps/api/test/plans.test.ts`, platform console limit-override form if keys are listed explicitly (check `routes/platform*`).
Web: `apps/web/src/lib/plans.ts`, `apps/web/src/components/plans/plan-comparison.tsx`, `apps/web/src/components/plans/locked-button.tsx` (reuse), pricing page `apps/web/src/app/(marketing)/pricing/page.tsx` (including its `BLURB`), `/admin/billing` usage rows.
Docs: `docs/PRICING.md`, `docs/FEATURES.md`, `docs/DECISIONS.md`, `docs/CHANGELOG.md`.

## Proposed updated plan table (for `docs/PRICING.md` when W1 ships)

Existing rows are unchanged; add:

| | Free | Team | Business |
| --- | --- | --- | --- |
| **Work items** (`work_items`) | 250 | Unlimited | Unlimited |
| Kanban boards, statuses, comments, links, search | Yes | Yes | Yes |
| **Max attachment size** (`max_attachment_mb`) | 5 MB | 25 MB | 100 MB |
| Scrum: backlog and sprints (`scrum_sprints`) | No | Yes | Yes |
| Saved filters shared with the space (`shared_filters`) | No | Yes | Yes |
| Burndown and sprint report (`burndown_reports`) | No | No | Yes |

Pricing page copy guidance: lead with outcomes ("Plan sprints", "See progress at a glance") rather than key names; show the new rows in the comparison table grouped under a "Work management" heading; the Free column should read as generous ("250 work items, Kanban boards, comments") not as a restriction list.

## UI for pricing (user friendly, consistent with Phase 9)

- Upgrade prompts are inline, calm and specific (name the limit and the next plan that lifts it), never modal-blocking. Use the existing `Notice` shared component and `LockedButton`.
- Usage bars use the same component as `/admin/billing` today; amber at 80%, red at 100%, always with text ("212 of 250 work items").
- Lock chips pair an icon with the word "Team" or "Business".
- Pricing page: add the Work management group to `plan-comparison.tsx` with the same checkmark/limit formatting as existing rows; keep mobile layout (stacked plan cards).
- Add a `/design` entry for the usage meter and lock chip if they are new variants.

## Tests

- Seeded plan values (Free/Team/Business) for each new key.
- `assertWithinLimit('work_items')` at cap, below cap, with override up, with override null, Internal workspace, ended trial (counts as Free).
- Soft-deleted items do not count toward the cap.
- `assertFeature` for each new feature on each plan, both API and UI mirror (`useHasFeature` unit test).
- Downgrade keeps data readable and blocks only creation.
- Attachment limit and storage quota (W3); shared filters (W4); Scrum and burndown (W6); an active sprint can still be completed after losing `scrum_sprints`.
