# Messaging: progress

**Brief:** `docs/Messaging Module Build Brief.md` (the brief's kickoff prompt expects `docs/MESSAGING-BRIEF.md`; the file keeps its current name, rename it if you prefer).
**Stack difference from the brief:** MongoDB instead of PostgreSQL (see ADR-051 and ADR-068 to ADR-071). Every "table", "row-level security" and "migration" in the brief is a collection, the repository-layer tenant guard (`TenantDb`) and an idempotent index in `apps/api/src/db/indexes.ts`.
**Prerequisites:** foundation and work items W1 to W14 are done.

## Phase status

| Phase | Title | Status | Notes |
| --- | --- | --- | --- |
| M1 | Real-time core | Review | Built and tested, awaiting owner sign-off. Not committed yet. Details below |
| M2 | Rich messaging | Review | Built and tested, awaiting owner sign-off. Details below |
| M3 | Search and notifications | Not started | `$text` index behind a `SearchService`, notifications, Threads page, sections, quick switcher |
| M4 | Platform integration | Not started | |
| M5 | Admin and extensibility | Not started | |
| M6 | Hardening | Not started | |

## M1: what was built

- **Data:** collections `channels`, `channel_members`, `messages`, `message_edits`, `read_cursors`, `user_statuses` (`apps/api/src/db/`). `messages` already carries the M2 thread fields (`threadRootId`, `alsoInChannel`, `replyCount`, `lastReplyAt`) and `metadata`, so M2 needs no data migration.
- **Services** (`apps/api/src/messaging/`): channels and membership, messages (idempotent send, edit with history, tombstone delete, paged history, reconnect sync), read state, presence, rate limits, the event sink. REST routes (`apps/api/src/routes/messaging.ts`) and the gateway call the same functions and `can()`.
- **Gateway** (`apps/realtime`): Socket.IO, handshake by tenant host and session cookie, server-chosen rooms, `message:send` (acknowledged after storing), `message:edit`, `message:delete`, `read:update`, `typing:start`, `presence:update`, `sync`; revoke on logout, deactivation and role change; five-minute session re-check.
- **Web** (`apps/web/src/components/messages`, `apps/web/src/app/(app)/messages`): conversation list, virtualized conversation, composer, message rows, pending and failed states, details panel, new message, create channel (four steps), channel browser, connection banner, typing indicator, skeletons and empty states, phone layout. Components are on the `/design` page.
- **Tests:** `apps/api/test/messaging.test.ts` (34), `apps/api/test/realtime.test.ts` (19, runs the gateway with real socket clients, including the cross-workspace attack cases, reconnect sync, removed members and deactivation), `apps/web/src/lib/messaging-logic.test.ts` (16), `e2e/messaging.spec.ts` (browser, including an accessibility scan).

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

- 2026-10-16: M2 built and verified (typecheck, lint, API, gateway and logic tests, browser tests). Waiting for owner review.
- 2026-10-16: M1 built and verified (typecheck, lint, API tests, gateway tests, web tests, browser tests). Waiting for owner review.
