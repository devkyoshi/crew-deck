# UI spec: work items, boards and backlog

Goal: a calm, fast, friendly interface at the level of Linear and Jira, inside the existing app shell and design system (shadcn "new-york", Tailwind 4, oklch tokens in `apps/web/src/app/globals.css`). Source: brief sections 4, 6, 8 and the Board UI prompt (section 12). This file turns them into concrete rules; where a value says "propose", the owner approves it on the `/design` page.

## 0. Process (mandatory)

1. Build new shared components on `/design` (`apps/web/src/app/design/showcase.tsx`), in light and dark side by side, with realistic data (long titles, no assignee, overdue date, many labels).
2. Ask the owner to approve them. Only then build the full screens.
3. Components required on `/design` for W1: work item card (comfortable and compact), column header (count and WIP states), type icon set, priority icon set, status chip (three categories), item panel skeleton, empty board, inline create row, usage meter and lock chip (pricing). Later: filter bar and chips (W2), rich text editor (W3), sprint header (W6), burndown chart (W6), notification bell and item (W5).
4. Never hard-code colours in feature components: use the tokens below.

## 1. Principles

- **Quiet by default.** Neutral surfaces, thin borders, colour reserved for meaning (type, priority, category, overdue, WIP). The tenant accent (`--primary`) is used only for focus rings, selected states, primary buttons and the active tab.
- **Never colour alone.** Every colour has an icon or text (status chip: icon + label; priority: icon + tooltip/label in pickers; overdue: clock icon + date).
- **Direct manipulation, with a keyboard path for everything.** Anything draggable also has a menu action.
- **No layout shift.** Reserve space for avatars, counts and badges. Skeletons match the final geometry.
- **Optimistic and honest.** Changes apply instantly, show a subtle "Saving..." then "Saved", and roll back with a plain-language toast on failure.
- **Dense but breathable.** 14px base text, 13px in dense areas (cards, list rows, panel fields), 12px for meta. Comfortable vs compact density toggle, remembered per user (localStorage key per user id, try/catch around access; also saved server-side later if a profile preference store exists).

## 2. Tokens (add to `globals.css`, light and dark)

Propose values in oklch so contrast is verifiable. All text-on-fill pairs must reach WCAG AA (4.5:1 for text, 3:1 for icons and borders).

### Item types (icon in a rounded square, 16px in cards, 20px in pickers)

| Type | Icon (lucide) | Hue | Notes |
| --- | --- | --- | --- |
| Epic | `Zap` | purple | Largest container |
| Story | `BookOpen` | green | |
| Task | `CheckSquare` | blue | Default type |
| Bug | `Bug` | red | |
| Subtask | `ListTree` (or `CornerDownRight`) | slate | Smaller, muted |

Tokens: `--type-epic`, `--type-story`, `--type-task`, `--type-bug`, `--type-subtask` (fill) and matching `-fg`.

### Priorities (icon + hue; label always in pickers, tooltip on cards)

| Priority | Icon (lucide) | Hue |
| --- | --- | --- |
| Highest | `ChevronsUp` | red |
| High | `ChevronUp` | orange |
| Medium | `Equal` | amber |
| Low | `ChevronDown` | blue |
| Lowest | `ChevronsDown` | slate |

Tokens: `--priority-highest` ... `--priority-lowest`.

### Status categories (chip = dot/icon + label; column top accent bar 3px)

| Category | Icon | Hue |
| --- | --- | --- |
| To do | `Circle` | slate |
| In progress | `CircleDot` / `Loader` | blue |
| Done | `CheckCircle2` | green |

Tokens: `--cat-todo`, `--cat-progress`, `--cat-done`. A status's own `color` (user-chosen from a fixed palette of 8-10 accessible swatches, not free hex) tints only the small dot beside the name; the category icon is always present.

### Other

- Overdue: `--destructive` text + `Clock` icon. Due soon (within 24 h): amber.
- WIP warning: amber chip with `AlertTriangle` and text "5 of 4" ("over limit").
- Elevation: card rest = 1px border `--border`, no shadow; hover = shadow-sm and 1px lift (`translate-y-[-1px]`, 120 ms); drag = shadow-lg and `rotate-[2deg]`; focus = 2px ring `--ring` with 2px offset.
- Radius: cards `rounded-lg` (8px), chips `rounded-md`, avatars full.
- Motion: 120-200 ms ease-out; respect `prefers-reduced-motion` (no rotation, no animated drop; instant state change).

## 3. Components

### Work item card

Order, top to bottom (all optional fields collapse without leaving gaps):
1. Title (max 2 lines, `line-clamp-2`, 14px comfortable / 13px compact, medium weight).
2. Meta row 1: epic chip (coloured dot + epic name truncated) and up to two label chips + "+N".
3. Meta row 2, left: type icon, key (`ENG-142`, 12px mono-ish muted), priority icon. Right: subtask progress ("2/5" with a tiny ring or bar), comment count, attachment count, due date (overdue red + clock), estimate pill, assignee avatar (24px; dashed "unassigned" avatar outline when empty).
Drag handle button appears on hover/focus at the top-right (visible always on touch). Card menu (`...`) next to it. Whole card is a button that opens the panel; the handle and menu are separate buttons (no nesting interactive elements, ADR-036).
States: default, hover, focus-visible, selected (multi-select: accent ring + checkbox), dragging (source stays as a faint placeholder, overlay card rotated with shadow), drag-over (insertion line 2px accent, 8px gap opens), done (title slightly muted, check icon on the type icon is not needed; category colour conveys it), blocked (small `Ban` icon when it has an unresolved "blocks" link), skeleton.
Compact density: hides meta row 1 except epic dot, padding `p-2`, 13px title, 20px avatar.

### Column

- Width 288px (comfortable) / 264px (compact); background `--muted/40` with 12px radius; 3px top accent in the category colour.
- Sticky header: category icon, status name (truncate), count badge, WIP usage when set ("3 / 5"; amber when at limit, red-amber `AlertTriangle` + text when over), collapse button, column menu (admins: edit status, set WIP).
- Body scrolls independently (`ScrollArea`), 8px gaps, "Load more" button at the end when `next_cursor` exists (shows "Show 50 more of 123").
- Footer: "+ Create" row; click turns it into a one-line input; Enter creates, Shift+Enter keeps it open, Esc cancels.
- Collapsed column: 48px wide vertical strip with rotated name and count.
- Drop target states: valid (accent outline + subtle tint), invalid/readonly (none), over WIP (amber outline, still allows drop).

### Filter bar (W2)

One row above the board: search input (`/` focuses), assignee avatar stack with multi-select popover (checkbox list with search, "Unassigned"), then Type, Priority, Label, Epic, Due (presets: overdue, today, this week, none, custom range) as compact popover buttons, quick filter toggles (My items, Recently updated), "Saved filters" menu, "Clear all". Active filters show a count on their button and as removable chips on a second line only when something is active. Everything syncs to the URL. Sticky under the space tabs.

### Item detail (panel and page)

- Panel: right `Sheet`, width 720px desktop (resizable between 560 and 960, remembered), overlays on tablet, full-screen on mobile. Header: breadcrumb (space > epic > key), type icon (opens type menu), copy-link and copy-key buttons, watch toggle, `...` menu (duplicate, move to space, delete), close.
- Body is two columns above 900px: main (title, description, subtasks, links, attachments, tabs) and a 280px field column (Status, Assignee, Reporter, Priority, Estimate, Due date, Labels, Parent epic, Sprint, Created, Updated). Below 900px the field column moves under the title as a 2-column grid.
- Fields are inline-editable: hover reveals a subtle border and pencil; click opens the picker (`Command` + `Popover`); Enter saves, Esc cancels. A small status line near the title shows "Saving..." / "Saved" / "Couldn't save. Retry".
- Title: large editable text, autosize.
- Description: placeholder "Add a description...", toolbar appears on focus (headings, bold, italic, lists, checklist, code, table, mention). Autosave with debounce.
- Tabs: Comments (default, composer pinned at bottom with avatar, "Cmd+Enter to send"), Activity (timeline with icons, "Sam moved this from In Progress to In Review", relative time with exact time on hover), Watchers (avatar list, add/remove).
- Stale edit: inline banner "This item was changed by someone else. Reload to see the latest." with a Reload button; unsent text is kept.
- Read-only (viewer): fields look like plain text, with a small lock hint on hover ("Viewers can't edit"); no composer; tooltip not toast.

### Backlog (W6)

Sections stacked: active sprint (accent left border, header shows name, date range, days left, count, points, "Complete sprint"), planned sprints (collapsible, "Start sprint" when startable), backlog. Row = type icon, key, title, epic chip, labels, status chip, estimate pill, assignee. Left epics panel (collapsible, `ResizablePanel`) with progress bars; clicking filters. Empty sprint: dashed drop zone "Drag items here to plan this sprint". Sprint header component goes on `/design` first.

### Complete sprint dialog (W6)

Three steps with a stepper (reuse `components/shared/stepper`): 1 Summary (done vs not done counts and points, lists), 2 Where do unfinished items go (radio cards: existing planned sprint, new sprint, back to backlog), 3 Confirm. Primary button names the outcome ("Complete and move 4 items to Sprint 7").

### Reports (W6)

Sprint selector, burndown chart (ideal dashed line, actual solid line, scope-change markers with tooltips, accessible colours and a "View as table" toggle, per the dataviz skill), below it the sprint report lists. Locked preview for non-Business plans.

### Other screens

- **List (W4):** dense table, sticky header, sortable columns with `aria-sort`, column picker, row hover actions, checkbox column, virtualized.
- **Epics (W4):** rows with colour dot, key, title, progress bar with "12 of 20 done", expandable child list.
- **My work (W4):** grouped sections with counts, saved filters on the left (collapses to a select on mobile).
- **Notifications (W5):** bell with count badge (99+ cap), popover of latest 8, inbox page with unread filter, mark all read; item = actor avatar + sentence + time + unread dot.
- **Command palette (W4):** results with type icon, key, title, status chip, space key; recent items when empty; footer hints.
- **Board settings:** status list with drag handles, inline rename, colour swatch popover, category select, WIP number input, delete with replacement dialog; live preview of the column header beside it.
- **Shortcuts overlay (`?`):** two-column groups (Navigation, Board, Item), listing only shortcuts that exist in the current phase.

## 4. States for every screen (non-optional)

| State | Rule |
| --- | --- |
| Loading | Skeleton with the same geometry (columns with 3-4 card skeletons; panel with title/field skeleton; list rows) |
| Empty | Illustration-free, icon + one sentence + one action. Board: "No work items yet. Create the first one." with a primary button. Filtered-empty: "Nothing matches these filters" + Clear filters. Backlog: "Your backlog is empty". Comments: "No comments yet. Start the conversation." Notifications: "You're all caught up" |
| Error | Reuse `error-view`/`load-error`: plain message, retry button, no stack traces. Mutation errors: toast with reason and the card snaps back |
| Permission | Viewers see disabled/hidden create and edit affordances with an explanatory tooltip; direct URLs to inaccessible items show the "no access / request access" view already used for spaces |
| Plan lock | `LockedButton` / lock chip + `Notice` naming the plan, never a dead end |
| Offline/stale | Subtle top banner "Reconnecting..." (W7) |

## 5. Responsive

- Desktop (>=1024): board with side panel overlay on the right (board stays visible and scrollable), panel does not push content.
- Tablet (640-1023): panel overlays the board at 90% width.
- Mobile (<640): columns are 85vw wide with horizontal scroll-snap, a column switcher chip row above, item view is a full-screen sheet, filter bar collapses into a "Filters" button with a bottom sheet, inline create becomes a floating "+" per column. Drag works with long-press via dnd-kit touch sensor; "Move to" menu is the primary mobile path.

## 6. Keyboard and accessibility

- Shortcuts: `C` create, `/` search, `?` overlay, `Esc` close, arrow keys move focus between cards and columns, `Enter` opens, `A` assign, `L` label, `M` comment (in panel), `Cmd/Ctrl+K` palette. Shortcuts ignore events from inputs and editors, and must be discoverable in the overlay.
- Drag: handle is a real `<button>` with `aria-label="Move ENG-142, press space to pick up"`; keyboard sensor (Space/Enter to lift, arrows to move, Space to drop, Esc to cancel); live-region announcements like "Picked up ENG-142 from In Progress, position 2 of 5" / "Moved to In Review, position 1 of 3" / "Cancelled, returned to In Progress".
- Visible focus on every control; focus returns to the originating card after the panel closes; panel traps focus and restores it.
- Colour contrast AA in light and dark; test chips on tinted column backgrounds.
- Landmarks and headings: board is a region labelled with the space; columns are lists (`role="list"`) with `aria-label="In Progress, 5 items"`.
- Respect `prefers-reduced-motion`. Touch targets at least 40px (cards' buttons) or 24px with spacing for dense controls.
- Forms: labels, `aria-invalid`, error text tied with `aria-describedby`.

## 7. Performance targets

- 500 items on a board: no jank while dragging (60 fps in a profile), first paint of skeleton immediate, first 50 per column under about 400 ms API time.
- Memoise `WorkItemCard` by item id and `updated_at`; keep drag state in a small context so the whole board does not re-render per pointer move; use `React.memo` on columns; virtualise columns above about 100 rendered cards and the list view always.
- Prefetch the item on card hover (TanStack Query `prefetchQuery`) so the panel opens instantly.

## 8. Copy style

Plain, short, friendly, no jargon: "Couldn't move ENG-142. Someone else changed it. Reload to see the latest." Buttons say what they do ("Create item", "Start sprint", "Complete sprint"). Dates use the user's locale; relative times for recent events.
