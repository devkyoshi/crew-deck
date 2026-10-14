# Open decisions from the brief (section 11)

Each has an answer so no phase is blocked. "Confirmed" means the owner said so; "Assumed" means it is the brief's default and stands unless the owner changes it. Reserved ADR numbers are written to `docs/DECISIONS.md` as 041 to 049.

| # | Decision | Answer | Status | ADR | Needed by |
| --- | --- | --- | --- | --- | --- |
| 1 | File storage for attachments | Local disk on the VM behind a `StorageDriver` adapter; S3-compatible driver later with no API change | **Confirmed** | 041 | W3 |
| 2 | Rich-text editor | Tiptap | Assumed | 042 | W3 |
| 3 | Who can delete items | Admins delete any; members delete only items they reported; viewers none | Assumed | 043 | W1 |
| 4 | Sprints on Kanban spaces | Kanban stays strictly continuous flow; Scrum is a separate board type | Assumed | 044 | W6 |
| 5 | Epics on the board | Hidden from the board; reached through an epic filter and the Epics page | Assumed | 045 | W1 |
| 6 | Estimate unit | Story points only (selector 1, 2, 3, 5, 8, 13 plus free numeric) | Assumed | 046 | W1 |
| 7 | Item types | Fixed five (epic, story, task, bug, subtask); no tenant-defined types | Assumed | 048 | W1 |
| 8 | Real-time transport | Server-sent events | Assumed | 049 | W7 |

Plan gates (limits and feature split by plan) are ADR-047; see `PRICING-GATES.md`. The proposed numbers there need owner confirmation before migration `0011`.

## Details and what changes if reversed

1. **Local disk storage.** Chosen because no bucket or credentials exist yet and the platform runs on a VM. Risks: single-host disk, backups, no CDN. Mitigation: the adapter, tenant-prefixed keys and signed URLs mean moving to S3 is a driver swap plus a copy script. Must be documented in Ops Memory (env names, directory/volume, backup note). If reversed to S3 now: build `S3Driver` in W3 instead of the stub and add bucket env names.
2. **Tiptap.** Matches the brief and the shadcn ecosystem. Descriptions and comments are stored as ProseMirror JSON, never HTML. If reversed, only the editor component and the JSON shape change; plain-text search projection (`search_text`) must be re-derived.
3. **Delete rule.** Matches brief section 7. If members may delete anything, `item.delete` loses the `isReporter` condition (and the matrix test row changes). If only admins may delete, remove the member-own branch.
4. **Kanban sprints.** Keeping Kanban strict keeps the board and backlog models simple. If later reversed, `boards.type` becomes a feature toggle (`sprints_enabled`) and the W6 board-type switch rules need rewriting.
5. **Epics hidden.** If epics should optionally appear as a swimlane, that is already one of the four swimlane modes (Epic); showing epics as cards would be a board setting added in W2.
6. **Points only.** `work_items.estimate` is numeric. Adding hours later means a second column and a board setting for which unit shows; sprint maths stay in points.
7. **Fixed types.** Enum in `packages/shared`. Custom types would need a `item_types` table and per-type hierarchy rules; deliberately out of scope.
8. **SSE.** One-way is enough (the client already sends changes by REST). Needs proxy buffering disabled and Redis pub/sub fan-out. WebSockets would only be needed for presence or collaborative editing, which are non-goals.

## Additional decisions made while splitting the brief (recorded for the owner)

- **Email provider:** the brief says SendGrid; the repo already sends through Brevo (`apps/api/src/email`). Use the existing queued sender. Record this in the W5 ADR.
- **Ranks:** work items use string ranks from `fractional-indexing` as the brief states; CRM deals keep their float `position` (ADR-034). Recorded in the W2 ADR.
- **Board type before W6:** the create-space wizard stores the board type but Scrum is shown as "Coming soon" until W6 ships (so nobody creates a Scrum space with no backlog UI).
- **One board per space** in v1 (`UNIQUE (space_id)`), matching "Every space has a board".
- **Parent delete:** deleting a parent soft-deletes its subtasks in the same transaction after a warning; epics are never auto-closed or cascaded (children simply lose the epic link in the UI, `parent_id` is kept for history).
- **Brief filename:** left as `docs/Work Items and Kanban Boards Build Brief.md`; the brief's own prompts mention `docs/WORK-ITEMS-BRIEF.md`. Rename only if the owner asks.
