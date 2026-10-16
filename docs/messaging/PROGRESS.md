# Messaging: progress

**Brief:** `docs/Messaging Module Build Brief.md` (the brief's kickoff prompt expects `docs/MESSAGING-BRIEF.md`; the file keeps its current name, rename it if you prefer).
**Stack difference from the brief:** MongoDB instead of PostgreSQL (see ADR-051 and ADR-068 to ADR-071). Every "table", "row-level security" and "migration" in the brief is a collection, the repository-layer tenant guard (`TenantDb`) and an idempotent index in `apps/api/src/db/indexes.ts`.
**Prerequisites:** foundation and work items W1 to W14 are done.

## Phase status

| Phase | Title | Status | Notes |
| --- | --- | --- | --- |
| M1 | Real-time core | Review | Built and tested, awaiting owner sign-off. Not committed yet. Details below |
| M2 | Rich messaging | Review | Built and tested, awaiting owner sign-off. Details below |
| M3 | Search and notifications | Review | Built and tested, awaiting owner sign-off. Details below |
| M4 | Platform integration | Review | Built and tested, awaiting owner sign-off. Details below |
| M5 | Admin and extensibility | Review | Built and tested, awaiting owner sign-off. Details below |
| M6 | Hardening | Not started | |

## M1: what was built

- **Data:** collections `channels`, `channel_members`, `messages`, `message_edits`, `read_cursors`, `user_statuses` (`apps/api/src/db/`). `messages` already carries the M2 thread fields (`threadRootId`, `alsoInChannel`, `replyCount`, `lastReplyAt`) and `metadata`, so M2 needs no data migration.
- **Services** (`apps/api/src/messaging/`): channels and membership, messages (idempotent send, edit with history, tombstone delete, paged history, reconnect sync), read state, presence, rate limits, the event sink. REST routes (`apps/api/src/routes/messaging.ts`) and the gateway call the same functions and `can()`.
- **Gateway** (`apps/realtime`): Socket.IO, handshake by tenant host and session cookie, server-chosen rooms, `message:send` (acknowledged after storing), `message:edit`, `message:delete`, `read:update`, `typing:start`, `presence:update`, `sync`; revoke on logout, deactivation and role change; five-minute session re-check.
- **Web** (`apps/web/src/components/messages`, `apps/web/src/app/(app)/messages`): conversation list, virtualized conversation, composer, message rows, pending and failed states, details panel, new message, create channel (four steps), channel browser, connection banner, typing indicator, skeletons and empty states, phone layout. Components are on the `/design` page.
- **Tests:** `apps/api/test/messaging.test.ts` (34), `apps/api/test/realtime.test.ts` (19, runs the gateway with real socket clients, including the cross-workspace attack cases, reconnect sync, removed members and deactivation), `apps/web/src/lib/messaging-logic.test.ts` (16), `e2e/messaging.spec.ts` (browser, including an accessibility scan).

## M5: what was built

- **Settings and plan limits:** `messaging/settings.ts`, `routes/messaging-admin.ts` (`GET/PUT /admin/messaging-settings`), enforcement in `channels.ts` (creation rule, channel limit, announcement default, default channels), `messages.ts` (`@channel` threshold, plan history window), `space-channels.ts` (space channels off), `notify.ts` (on leave pauses notifications), plan keys `channels` and `message_history_days` in `plans/index.ts` and `db/reference.ts`.
- **Retention:** `messaging/retention.ts` (purge, per-channel override, hourly BullMQ job), `GET /admin/retention`, `PUT /admin/channels/:id/retention`.
- **Export:** `messaging/export.ts` (`POST/GET /admin/export`, `GET /admin/export/:id`, `/file`).
- **Webhooks and bots:** `messaging/webhooks.ts`, `bot.ts` (webhook bots `wh:<id>`), `POST /channels/:id/webhooks`, `GET /channels/:id/webhooks`, `DELETE /webhooks/:id`, public `POST /hooks/:token`.
- **CRM:** `messaging/crm-channels.ts`, `POST /crm/:deals|companies/:id/channel`, hooks in the CRM deal and activity routes.
- **Web:** Settings > Messaging (rules, default channels, retention with per-channel limits, export), webhooks in the channel details, retention note, "Open channel" on CRM deals and companies, hidden "Create a channel" when limited, "Older messages are hidden" note, plan limits on the plans pages.
- Tests: `apps/api/test/messaging-m5.test.ts` (18), `e2e/messaging-m5.spec.ts` (5); earlier tests updated for the new fields.
- **Not done in M5 (and why):** message edit window and DM restrictions (the brief marks both as later); "add everyone now" for a new default channel (only new people are added); a legal hold; cards and bots for third-party apps beyond webhooks (the brief puts an app directory and OAuth out of scope); webhook posts do not support formatting, attachments or mentions by design.

## M4: what was built

- **Space channels:** `apps/api/src/messaging/space-channels.ts` (create, sync, repair), `routes/space-sync-hook.ts` (the events), `GET /spaces/:id/channel` (by key or id), `readOnly` on channels, viewer rules in `access.ts`, nightly repair in `server.ts`.
- **Cards and create from message:** `item-links.ts` (`message_links`, `GET /items/:ref/card`), `integration.ts` (`POST /messages/:id/create-work-item`, where an item came from), `bot.ts` (`postAsBot`).
- **Activity bot:** `activity-bot.ts` (rules, event buffer, coalescing, BullMQ worker), hooks in `work/activity.ts` and `routes/sprints.ts`, `GET/PUT /channels/:id/activity-rules`.
- **Slash commands:** `commands.ts`, `me.ts` (status and do not disturb), `GET /commands`, `POST /commands/execute`.
- **Check-in badges and profile card:** `people.ts`, `checkin` in the presence lookup, `GET /people/:id/card`.
- **Web:** item cards, create-from-message dialog, slash menu in the composer, docked chat on Board and Backlog, space channel details (rules, no leave), profile popover, check-in pills, read-only note. The new pieces are on the /design page.
- Tests: `apps/api/test/messaging-m4.test.ts` (25), two more gateway tests (space membership and viewers over the socket), `e2e/messaging-m4.spec.ts` (6).
- **Not done in M4 (and why):** the tenant setting to turn space channels off and the "on leave sets do not disturb" setting (both belong to the M5 settings screen); `/standup` and `/deal` (later phases); cards do not update the instant an item changes (they refetch when the tab regains focus once their data is 30 seconds old; live item events can drive this later); the profile card lists a count of open work, not a link to a filtered list.

## M3: what was built

- **Search:** `apps/api/src/messaging/search.ts` (`SearchService` with a Mongo text implementation, the query language, snippets), `GET /search/messages` and `/search/files`; web `messages/search`.
- **Notifications:** `apps/api/src/messaging/notify.ts` (who is told and why, the unseen-email check), `quiet.ts` (quiet hours), viewing and do-not-disturb in `presence.ts`, the `view:update` and `notification:new` events, new notification kinds and preference fields (quiet hours, email delay, desktop), reading a conversation clears its notifications.
- **Web:** Threads, Mentions and reactions, Starred and custom sections (drag or menu), conversation row menu (star, move, mute), do not disturb and status, quick switcher in Ctrl+K, Alt+Shift+Up/Down and Esc shortcuts, desktop notifications, notification settings.
- Tests: `apps/api/test/messaging-m3.test.ts` (25), three more gateway tests, `e2e/messaging-m3.spec.ts` (9), `apps/web/src/lib/search-tokens.test.ts`.
- **Not done in M3 (and why):** comfortable/compact density; the "Mentions and reactions" list is not live (it refreshes when opened); email digest for chat uses the existing daily-summary switch; offline desktop push (needs a service worker, mobile push is a later phase).

## M2: what was built

- **Threads** (reply panel, summary under the root, also-send-to-channel, follow/unfollow, `GET /threads`), **reactions** (emoji-mart picker, chips, who-reacted tooltip), **mentions** (people, groups, `@channel`, `@here`, autocomplete, highlight, channel mention counts, "add them?" prompt), **pins** and a Pins tab, **saved messages** and a Saved page, **files** (upload with progress and cancel, drag and drop, paste, lightbox, Files tab, access-checked downloads, plan limits), **link previews** (worker, SSRF guards, per-workspace cache), `:name:` shortcodes, message actions menu.
- API: `apps/api/src/messaging/{threads,reactions,pins,files,link-preview,ssrf}.ts`; routes in `apps/api/src/routes/messaging.ts`. Web: `apps/web/src/components/messages/{thread-panel,message-parts,message-actions,emoji-picker,channel-tabs}.tsx` and `app/(app)/messages/saved`.
- Tests: `apps/api/test/messaging-rich.test.ts` (31), `apps/api/test/link-preview.test.ts` (59, including the address table), two more gateway tests, `e2e/messaging-rich.spec.ts` (6, browser).
- **Not done in M2 (and why):** `#channel` and work item key autocomplete (item keys belong with the unfurls in M4); generated thumbnails and PDF previews; a virus-scan hook; syntax highlighting in code blocks (copy button is there); the Threads page and the "Mentions and reactions" list (M3); direct-to-storage signed uploads (ADR-073).

## M1: "done when" check

- Two people in different browsers chat in real time: browser test.
- Messages survive reconnects without loss or duplicates: gateway test (sync, no duplicates, refetch when too much was missed) and a browser test that takes one browser offline.
- Unread counts are correct across two tabs: gateway test (`read:synced` reaches the other tab) and browser tests.
- Socket isolation tests pass: a person from another workspace gets `FORBIDDEN` and hears nothing; a removed member stops receiving at once; a deactivated person's sockets are disconnected.

## Deviations and things to know

- **Default channels are created lazily** the first time a person opens Messages, not at provisioning (ADR-068). The first person to open it owns `#general` and `#announcements`.
- **Presence changes are broadcast to the whole workspace room**, which is fine for small and medium workspaces; M6 should measure it and could narrow it to people who share a channel.
- **Slow consumers:** the gateway relies on Socket.IO's ping timeout (15 s interval, 20 s timeout). It does not yet drop a client whose outgoing buffer grows; add this in M6.
- **Rate limiting** is a Redis token bucket (per person and per workspace); typing uses a 3 second cooldown key.
- **Channel creation** is open to every member until the admin settings (M5); `can()` already has the action.
- **Not in M1 (by plan):** threads, reactions, mentions, pins, saved items, files, link previews, search, notifications (the notification level is stored but does nothing yet), custom sidebar sections, quick switcher, space channels, unfurls, slash commands, comfortable/compact density.
- **Known time-dependent test:** `apps/api/test/service-desk.test.ts` (two cases) depends on the clock relative to the workspace working hours and fails when run during UTC working hours. It was already like that before messaging and is unrelated.

## Running it

`pnpm dev` starts the API and web app; the gateway is separate: `pnpm --filter @crew-deck/realtime dev` (port 4100). In development the browser connects to port 4100 on the tenant host; in production the reverse proxy routes `/realtime` to the gateway (`docs/DEPLOYMENT.md`).

## Log (newest first)

- 2026-10-16: M5 built and verified (typecheck, lint, API, gateway, browser tests). Waiting for owner review.
- 2026-10-16: M4 built and verified (typecheck, lint, API, gateway, browser tests). Waiting for owner review.
- 2026-10-16: M3 built and verified (typecheck, lint, API, gateway and logic tests, browser tests). Waiting for owner review.
- 2026-10-16: M2 built and verified (typecheck, lint, API, gateway and logic tests, browser tests). Waiting for owner review.
- 2026-10-16: M1 built and verified (typecheck, lint, API tests, gateway tests, web tests, browser tests). Waiting for owner review.
