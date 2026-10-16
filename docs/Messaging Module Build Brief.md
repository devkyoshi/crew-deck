# Messaging Module: Build Brief

Oct 16, 2026 · @Ashi

## 1. Overview

This brief covers the native messaging module of the multi-tenant company platform: channels, direct messages, threads and real-time delivery, tightly integrated with spaces and work items. It builds on two earlier briefs, the *Company Workspace Platform: Build Brief* (foundation) and the *Work Items and Kanban Boards: Build Brief*, and **their rules, tech stack, tenancy model, permission module and design system apply here unchanged**.

**Goals**

- Real-time channels (public and private), direct messages and group DMs, with threads, reactions, mentions and file sharing
- Reliable delivery and correct unread state, across tabs and devices
- Presence (online, away, do not disturb) and typing indicators
- Search across everything a user can access
- Deep platform integration: a channel per space with synced membership, work item unfurls, create a work item from a message, an activity bot, and slash commands
- In-app, push and email notifications with per-user preferences
- Strict tenant isolation on every message, connection and file
- A polished, Slack-grade UI built with shadcn/ui

**Non-goals for this module (do not build)**

- Voice, video, huddles or screen sharing (integrate Meet or Zoom later)
- Connecting to a customer's own Slack or Microsoft Teams
- Third-party app directory and OAuth for external apps (webhooks and the internal bot framework come late in the plan)
- Canvas or shared notes, polls, scheduled messages and reminders (listed as later phases)
- End-to-end encryption, guests and external users, cross-tenant shared channels

If a task seems to need one of these, stop and ask instead of adding it.

**Prerequisites:** foundation Phases 0 to 5 (tenants, auth, members, groups, spaces, space roles, audit log) and work items phases W1 to W3 (so unfurls and create-from-message have something to link to). Phases that depend on later work item features say so.

## 2. Architecture

Messaging is a real-time system, so it has a few moving parts the earlier modules did not need. The drawing shows how they fit together.

&#91;embedded content: real-time architecture · 7 components, 1 source of truth\]

PostgreSQL is the source of truth. A message is written there first, then published through Redis so every gateway instance can push it to the clients it holds. Clients also use plain REST for history, search and uploads. The gateway holds no state of its own, so any instance can serve any client.

**Design principles**

- **Persist first, publish second.** The sender's client shows the message optimistically, but treats it as sent only after the server acknowledges it
- **Stateless gateway.** Deploy it as its own service (`apps/realtime`), sharing `packages/shared` with the API. Scale it horizontally behind a load balancer with sticky sessions disabled
- **Tenant checks at four points:** connection handshake, channel subscribe, message publish, and history fetch. Never trust a channel id sent by the client
- **Presence and typing never touch Postgres.** They live in Redis with short TTLs
- **One code path for permissions.** The gateway and the REST API both call the same `can()` module

**Stack choices**

| Concern | Choice | Notes |
| --- | --- | --- |
| Transport | Socket.IO with the Redis adapter | Rooms, automatic reconnection and fallbacks. Plain `ws` is the alternative (see open decisions) |
| Fan-out | Redis pub/sub | Room names are prefixed `org:{id}:channel:{id}` |
| Persistence | PostgreSQL with row-level security | Index `(channel_id, seq)`. Plan monthly partitioning by `created_at` only when volume requires it |
| Message format | Small structured JSON document (Tiptap-compatible subset) plus a plain-text mirror | The mirror powers search, notifications and previews |
| Search | Postgres full-text (`tsvector` with a GIN index) behind a `SearchService` interface | Replaceable by Meilisearch or OpenSearch later without API changes |
| Files | S3-compatible storage, direct upload by signed URL | Thumbnails and virus-scan hooks run in workers |
| Jobs | BullMQ | Push, email, unfurls, search indexing, bot posts, retention |
| Client state | TanStack Query for history, a small store (Zustand) for live events | One normalized message cache shared by channel, thread and search views |

## 3. Domain model

Every table carries `org_id` (the tenant key) with row-level security, following the foundation brief.

**Channels and membership**

| Table | Key fields |
| --- | --- |
| channels | id, type (public, private, dm, group\_dm), name, slug, topic, description, space\_id (null unless a space channel), dm\_key (hash of sorted member ids, unique per tenant, DMs only), is\_announcement, is\_archived, created\_by, last\_seq, last\_message\_at |
| channel\_members | channel\_id, user\_id, role (owner, member), joined\_at, notification\_level (all, mentions, none), muted\_until, is\_starred, section\_id |
| sidebar\_sections | id, user\_id, name, position (custom sidebar groups) |

**Messages**

| Table | Key fields |
| --- | --- |
| messages | id, channel\_id, seq, kind (user, system, bot), author\_id, bot\_id, body (JSON), body\_text, thread\_root\_id, also\_in\_channel, reply\_count, last\_reply\_at, client\_msg\_id, metadata (unfurls, linked work items), edited\_at, deleted\_at, created\_at |
| message\_edits | id, message\_id, old\_body, edited\_at |
| message\_reactions | message\_id, user\_id, emoji, created\_at |
| message\_mentions | message\_id, target\_type (user, group, channel, here), target\_id |
| message\_attachments | id, message\_id, uploader\_id, file\_name, mime\_type, size, storage\_key, width, height, thumbnail\_key |
| pins | channel\_id, message\_id, pinned\_by, pinned\_at |
| saved\_messages | user\_id, message\_id, saved\_at |

**State and extras**

| Table | Key fields |
| --- | --- |
| read\_cursors | channel\_id, user\_id, last\_read\_seq, last\_read\_at |
| thread\_follows | thread\_root\_id, user\_id, last\_read\_message\_id |
| user\_statuses | user\_id, emoji, text, expires\_at (custom status; live presence is in Redis) |
| link\_previews | id, url\_hash, title, description, image\_url, fetched\_at (cache, tenant-scoped) |
| bots | id, name, avatar\_url, type (activity, webhook, system) |
| incoming\_webhooks | id, channel\_id, bot\_id, token\_hash, created\_by, revoked\_at |
| activity\_rules | id, channel\_id, space\_id, event\_types, filters (what the activity bot posts) |
| messaging\_settings | one row per tenant: who can create channels, who can use @channel and @here, default channels for new members, retention\_days |

**Rules**

- **Ordering:** each channel has a `last_seq` counter. A new message increments it inside the insert transaction, so `seq` is strictly increasing per channel and is the order everyone sees. Thread replies take a `seq` in the same channel
- **Idempotency:** a unique index on `(channel_id, client_msg_id)` makes a retried send safe. The server returns the existing message instead of creating a duplicate
- **Unread state** is a cursor, not a row per message: unread count is the number of messages with `seq` greater than `last_read_seq`, excluding thread replies that are not also in the channel. Mention counts are derived from `message_mentions`
- **Soft delete:** deleting a message sets `deleted_at`, clears the body, and leaves a tombstone so threads and ordering stay intact. Edits keep history in `message_edits`, visible to admins only
- **DMs:** `dm_key` guarantees one DM per pair and one group DM per exact set of members. Group DMs are capped at 8 people
- **Space channels:** `space_id` is set, there is at most one per space, and membership follows the space (see section 4)
- **Archived channels** are read-only and searchable. Channel names are unique per tenant among public and private channels, case-insensitive

## 4. Channels, DMs and membership

**Conversation types**

| Type | Who can see and join | Notes |
| --- | --- | --- |
| Public channel | Any member of the tenant can browse, preview and join | Listed in the channel browser |
| Private channel | Members only, joined by invitation | Not listed or searchable to non-members. Org admins can archive or delete it without reading it |
| Space channel | Follows the space: public for open spaces, private for private spaces | One per space, membership synced automatically (below) |
| Direct message | Two people | Created on the first message. One DM per pair |
| Group DM | Three to eight people | Adding someone to a DM creates a new group DM and keeps the original |
| Announcement channel | Any of the above types with `is_announcement` set | Only channel owners and admins can post. Everyone else can react and reply in threads |

**Channel rules**

- Names are lowercase with hyphens, up to 80 characters, and unique per tenant. A channel has a topic and a description
- A tenant setting controls who can create channels: all members (default) or admins only
- Every tenant is provisioned with `#general` and `#announcements` (post-restricted), plus any admin-defined default channels. New members join the defaults automatically
- **Roles:** channel owner (edit name and topic, manage members, archive) and member. The creator is the first owner. The last owner cannot leave without transferring ownership
- Archiving makes a channel read-only and keeps it searchable. Deletion is admin-only, requires confirmation, and is written to the audit log
- A deactivated user is removed from all channels. Their messages stay, shown with their name and a deactivated marker

**Space channels (the platform integration)**

- When a space is created, its channel is created too (a tenant setting, on by default), named after the space key, for example `#eng`
- **Membership is derived from effective space access.** Adding a person or a group to the space adds them to the channel, and removing them removes them. Space viewers can read the channel but cannot post
- Members cannot leave a space channel while they have space access. They can mute it instead
- Archiving a space archives its channel. A private space makes a private channel
- Sync is event-driven from the space membership module, with a nightly reconciliation job that repairs any drift
- Every sync-driven change is written to the audit log with the space as the cause

**Direct messages**

- Any two active members of the same tenant can DM each other. A tenant setting can later restrict this, but do not build it now
- Users can leave a group DM, and the DM stays for the remaining members
- Self-DM is allowed and acts as a personal notes space

## 5. Messaging behavior

**Composing and sending**

- Rich-text composer (Tiptap): bold, italic, strikethrough, inline code, code blocks with a language, links, lists, quotes, emoji shortcodes (`:smile:`), and autocomplete for @people, @groups, `#channels` and work item keys such as `ENG-142`
- Enter sends and Shift+Enter inserts a new line. Drafts are kept per conversation on the device
- Limits: 4,000 characters per message, up to 10 files per message, file size by plan (default 25 MB)
- Message states: sending, sent, failed (with retry), edited, deleted. A failed message stays in the list with a retry action
- Authors can edit their own messages at any time and delete them. Channel owners and org admins can delete any message. Deleted messages leave a tombstone
- Message actions: reply in thread, react, copy link, pin, save, mark unread, create work item, edit, delete

**Threads**

- Replies open in a side panel with the root message on top. The composer has an "Also send to channel" option
- The root message shows the reply count, participant avatars and the time of the last reply
- People who reply or are mentioned follow the thread automatically, and can follow or unfollow manually
- A **Threads** page lists followed threads with unread indicators. Thread replies count toward thread unread, not channel unread, unless sent to the channel too
- Threads do not nest

**Reactions**

- Emoji picker with search, recents and skin tones. Clicking an existing reaction toggles your own. A tooltip lists who reacted. Maximum 50 distinct emoji per message

**Mentions**

- `@person` notifies that person. `@group` notifies the group's members who are in the channel, and offers to add the others
- `@channel` notifies every member, and `@here` only members who are currently online. A tenant setting limits `@channel` and `@here` to admins in channels above a size threshold (default 50 members)
- Mentioning a person who is not in a private channel prompts the author to add them

**Files and link previews**

- Files upload directly to storage by signed URL, with progress and cancel. Images preview inline, PDFs get a thumbnail from a worker, and audio and video use native players
- Downloads use short-lived signed URLs checked against channel access. Dangerous extensions are blocked, and a virus-scan hook runs before a file becomes available
- A worker fetches link previews for external URLs with SSRF protection (no private IP ranges, size and time limits) and a tenant-scoped cache. Internal links unfurl as rich cards (section 8)

**Unread and read state**

- Opening a channel scrolls to the first unread message and shows a "New messages" divider. The read cursor advances only while the window is focused and the bottom of the list is visible
- Sidebar: bold for unread channels, a count badge for mentions and DMs. "Mark as unread" from any message and "Mark all as read" are supported
- Cursor changes sync to the user's other tabs and devices through events

**Presence and typing**

- States: online, away (idle for 10 minutes or app in the background), do not disturb, offline. Clients send a heartbeat every 30 seconds, and the Redis key expires after 90 seconds. Multiple connections of one user merge into one state
- Users can set a custom status (emoji, text, optional expiry) and do not disturb with a duration
- Typing events are throttled to one per 3 seconds, expire after 5 seconds, and show up to three names

**History, scrolling and search**

- Load the latest 50 messages, and page older ones by `before_seq`. A message link loads the window around that message and highlights it
- Group consecutive messages by the same author within 5 minutes, add date separators, and render system messages (joined, left, topic changed)
- The list is virtualized, and must stay smooth in a channel with 10,000 messages
- Search covers messages and files in conversations the user can access, with filters (`from`, `in`, `before`, `after`, `has:file`, `has:link`, `is:thread`) and highlighted snippets. Access is enforced inside the query, never after fetching results

**Retention:** a tenant default and an optional per-channel override, in days. A scheduled worker purges expired messages and their files. Legal hold is out of scope.

## 6. Real-time protocol

The drawing shows what happens when someone sends a message. The sender sees the message immediately, but the server only acknowledges it after it is stored, and only then does it fan out to everyone else.

&#91;embedded content: message send flow · 6 steps, 1 decision\]

After the save, the API also enqueues background jobs for notifications, link unfurls and search indexing. These never delay the acknowledgement or the fan-out.

**Events**

| Event | Direction | Purpose |
| --- | --- | --- |
| `message:send` | client to server | Send a message. Carries `client_msg_id`, channel, body, attachment ids, optional thread root. Uses an acknowledgement callback |
| `message:edit`, `message:delete` | client to server | Edit or delete own messages (admins can delete any) |
| `reaction:toggle` | client to server | Add or remove a reaction |
| `typing:start` | client to server | Throttled typing signal |
| `read:update` | client to server | Move the read cursor for a channel or thread |
| `presence:update` | client to server | Heartbeat, away and do-not-disturb changes |
| `sync` | client to server | After a reconnect, send the last seen `seq` per active channel and receive what was missed |
| `message:new`, `message:updated`, `message:deleted` | server to client | Message lifecycle |
| `reaction:updated`, `thread:updated` | server to client | Reaction and thread summary changes |
| `typing`, `presence:changed` | server to client | Ephemeral state |
| `channel:updated`, `channel:membership` | server to client | Channel changes, and joins or removals that change which rooms the user is in |
| `read:synced` | server to client | Cursor moved on another tab or device |
| `notification:new` | server to client | A new item for the notification inbox |
| `error` | server to client | Coded error: `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `CHANNEL_ARCHIVED`, `VALIDATION` |

**Rooms:** on connect the gateway joins the user to a personal room (`org:{id}:user:{id}`) and to a room for every channel they belong to. When membership changes, the gateway joins or leaves the room immediately. A removed member stops receiving events at once.

**Delivery guarantees**

- **Idempotent sends:** the client retries with the same `client_msg_id` using backoff until acknowledged. After 10 seconds without an acknowledgement the message shows as failed with a retry action
- **Ordering:** clients sort by `seq`. If a pushed message skips a `seq`, the client backfills the gap through REST
- **Reconnect:** the client sends `sync` with its last seen `seq` per active channel. The server returns up to 200 missed messages per channel, or tells the client to refetch through REST when more were missed. Unread counts are always refetched after a reconnect
- **Auth:** the session cookie is validated at the handshake and re-validated every 5 minutes. A logout, deactivation or role change publishes a revoke event that disconnects the user's sockets
- **Rate limits:** per-user token bucket in Redis (default 20 messages per 10 seconds), plus payload size limits and throttles on typing and presence
- **Slow consumers:** if a client falls too far behind, the server drops the connection and the client resyncs
- **Multiple tabs:** each tab holds its own connection. Cursor and presence changes are shared through the user room

## 7. Permissions, tenancy and notifications

**Permissions** reuse the foundation's `can(user, action, resource)` module, and both the REST API and the gateway call it. Space channels derive roles from space access: space admins and members behave as channel members, and space viewers are read-only.

| Action | Org admin | Channel owner | Channel member | Non-member |
| --- | --- | --- | --- | --- |
| Browse and join a public channel | Yes | Yes | Yes | Yes |
| See a private channel | Only as a member | Yes | Yes | No |
| Post a message | If a member | Yes | Yes (not in announcement channels or as a space viewer) | No |
| Post in an announcement channel | Yes | Yes | No (can reply in threads) | No |
| Edit or delete own messages | Yes | Yes | Yes | n/a |
| Delete others' messages | Yes | Yes | No | No |
| Pin messages | Yes | Yes | No | No |
| Edit topic, rename, manage members | Yes | Yes | No | No |
| Archive a channel | Yes | Yes | No | No |
| Delete a channel | Yes | No | No | No |
| Create a channel | Per tenant setting (all members or admins only) |  |  |  |
| Use @channel and @here | Per tenant setting and channel size threshold |  |  |  |
| Create incoming webhooks | Yes | Yes | No | No |
| Change messaging settings, retention, default channels | Yes | No | No | No |

**Multi-tenancy rules specific to this module**

- Every table in section 3 has `org_id` with row-level security
- The handshake resolves the tenant from the subdomain and must match the user's membership in that tenant. Room names, Redis keys, queue jobs and storage keys all carry the tenant id
- Never accept a room or channel id from a client without checking tenant and membership on the server
- Search, link preview cache and unfurls are tenant-scoped, and search access rules run inside the query
- Fair-use rate limits are applied per tenant as well as per user, so one tenant cannot starve the rest
- Plan limits (message history window, file storage, number of channels) are enforced in the API. Build no payment flow
- **Mandatory socket tests:** a user from tenant A who sends a tenant B channel id gets `FORBIDDEN` and never receives its events. A removed member stops receiving events immediately. A deactivated user's sockets are disconnected

**Notifications**

- Events that notify: direct messages, @mentions, replies in followed threads, new messages in channels set to "all", and being added to a channel
- Channels of delivery: in-app (sidebar badges and the notification inbox), desktop notifications through the browser API, and email for anything unseen after a delay (default 15 minutes, DMs and mentions only, batched). Mobile push is a later phase
- No notification when the user is online and viewing that conversation, and never for the author's own messages
- Channel level per user: all, mentions only, none, plus mute. A muted channel suppresses everything except direct @mentions of that person
- Do not disturb and quiet hours suppress push, desktop and email, but not badges
- Reuse the shared `notifications` table, preferences screen and SendGrid queue from the work items module, adding the new event types

## 8. Platform integration

This section is what makes the module more than a Slack clone. Chat should know about spaces, work items, people and check-in status. Space channels and their membership sync are in section 4.

**Work item unfurls**

- A message containing an item key (`ENG-142`) or an item link shows a card under it: type icon, key, title, status chip, assignee avatar and priority
- The message stores only the item id (`message_links`), and the card reads live data, so it updates when the item changes
- Access is enforced per viewer. A user without access to that space sees a neutral "no access" card with no title or details
- Requires work items phases W1 to W3

**Create a work item from a message**

- Message menu action "Create work item" opens the create dialog prefilled: title from the first line, description from the message with a link back, and the channel's space preselected for space channels (otherwise a space picker)
- After creation the bot replies in the thread with the new item's card, and the item records a "created from message" link back to the thread
- Requires create permission in the target space. The action is hidden when the user has no space where they can create items

**Activity bot (space channels)**

- A system bot posts compact cards for work item events: created, assigned, moved to a Done category, and sprint started or completed (Scrum spaces)
- Space admins choose the event types in channel settings (`activity_rules`). Defaults are conservative to avoid noise, and comments are off by default
- Events within 60 seconds are coalesced, for example "4 items moved to Done"
- The bot posts through the messaging service (never by writing to message tables directly), driven by work item events through a BullMQ worker
- It never posts in DMs, and it respects archived channels

**Slash commands**

A command registry (`name`, `description`, `scope`, `handler`, `required permission`) powers composer autocomplete when the user types `/`. Commands from a module that is switched off for the tenant are hidden. Responses can be ephemeral, visible only to the person who ran them.

| Command | Behavior | Depends on |
| --- | --- | --- |
| `/task create <title>` | Opens the create dialog prefilled | Work items |
| `/task ENG-142` | Shows the item card (ephemeral) | Work items |
| `/task mine` | Lists my open items (ephemeral) | Work items |
| `/checkin`, `/checkout` | Check in or out, with an optional note and location | Check-in module |
| `/status <emoji> <text>` | Sets a custom status | Messaging |
| `/dnd <duration>` | Starts do not disturb | Messaging |
| `/standup` | Starts the async standup prompt in the channel | Later phase |
| `/deal <name>` | Finds a CRM deal and shows its card | CRM module |

**Check-in and presence**

- A small badge next to names in the DM list, member lists and profile popovers shows the check-in location (onsite, remote, offsite) or on leave. It shows status only, never exact check-in times, matching the check-in module's privacy rule
- A tenant setting lets "on leave" set do not disturb automatically

**Profile popover:** avatar, name, title, groups, local time from their timezone, custom status, check-in badge, and actions (message, view their open items).

**Docked chat panel:** on a space's board and backlog pages, a button opens the space channel in a docked right panel, so people can chat while looking at the board.

**CRM:** an "Open channel" action on a company or deal page can create a channel that receives stage changes and new activities. This is a later phase.

## 9. UI requirements

The interface should feel like Slack: fast, keyboard-friendly and calm, inside the app shell and design system from the foundation brief. Reuse shared components, and add new ones to the `/design` page first.

**Layout**

- A new **Messages** area in the app. The left sidebar keeps the platform's grouped navigation, and the Messages area adds a conversation list with sections: Threads, Mentions and reactions, Saved, Starred, Channels, Direct messages, plus user-defined sections (collapsible and drag-reorderable)
- Center: the conversation (header, message list, composer). Right: a collapsible panel for threads, channel details (members, pins, files) and profile popovers
- Channel header: name, topic (editable inline), member avatar stack, and tabs for Messages, Pins and Files
- Unread channels are bold. Mentions and DMs show count badges. A "Jump to unread" pill appears when scrolled away from new messages

**Screens**

| Screen | What it contains |
| --- | --- |
| Conversation | Virtualized message list, date separators, grouped messages, hover toolbar, composer with formatting bar, typing indicator |
| Thread panel | Root message, replies, composer with "Also send to channel" |
| Threads page | Followed threads with unread state |
| Channel browser | Search and filter public channels, join and preview, create channel |
| Create channel | Multi-step dialog: name and type, description and topic, add people, review |
| Channel details | Members with roles, pins, files, notification settings, leave and archive |
| Search | Results page with filter chips (from, in, date, has) and highlighted snippets |
| New message | Person picker for DMs and group DMs |
| Profile popover | Avatar, title, groups, local time, status, check-in badge, actions |
| Notification preferences | Levels per channel, do not disturb schedule, email delay and digest |
| Admin messaging settings | Channel creation rules, @channel limits, default channels, retention, announcement defaults |

**Components (shadcn/ui first)**

- `Sidebar`, `ResizablePanel`, `Sheet` (mobile panels), `ScrollArea`, `Tabs`, `Command` (quick switcher and pickers), `Popover` (emoji, mentions, profile), `DropdownMenu` and `ContextMenu` (message actions), `Dialog` and `AlertDialog`, `Avatar` with a presence dot, `Badge`, `Tooltip`, `Sonner`, `Skeleton`
- Outside shadcn: Tiptap for the composer, TanStack Virtual for the message list, an emoji picker (emoji-mart or similar), and `react-dropzone` for uploads

**Message list details**

- Message rows: avatar, name, time, content, reactions, thread summary, attachments and unfurl cards. Hover shows a floating toolbar (react, reply, more). Own messages show edit and delete
- Pending messages are slightly dimmed, failed ones show a red retry bar. New incoming messages animate in subtly, and never move the view if the user is reading history
- Grouped consecutive messages hide repeated avatars. System messages and bot messages have distinct, quiet styling and a bot badge
- Code blocks get syntax highlighting and a copy button. Images open in a lightbox with arrow-key navigation

**Interaction and keyboard**

- Quick switcher on `Ctrl/Cmd+K`, previous or next unread channel on `Alt+Shift+Up/Down`, focus composer on `/` or by starting to type, `Up` in an empty composer edits the last message, `Esc` closes panels and marks the channel read
- Drag a file anywhere over the conversation to upload. Paste images from the clipboard
- Desktop notifications ask for permission contextually, not on first load

**Responsive and quality bar**

- Tablet: the right panel overlays. Mobile: the conversation list and the conversation are separate screens, panels are full-screen sheets, and the composer stays above the keyboard
- Loading skeletons shaped like messages, helpful empty states (an empty channel prompts the first message), friendly connection states (a quiet banner when reconnecting), visible focus, WCAG AA contrast, and no layout shift when images or unfurls load (reserve their space)
- The message list stays smooth with 10,000 messages in a channel

## 10. API outline

REST under `/api/v1`, following the foundation conventions (zod validation, cookie sessions, `can()` on every route, consistent error shape). The WebSocket gateway lives at `/realtime`, and its events are in section 6. REST and socket handlers must call the same service functions, so behavior and permissions never diverge.

| Resource | Endpoints | Phase |
| --- | --- | --- |
| Channels | `GET /channels` (mine), `POST /channels`, `GET /channels/:id`, `PATCH /channels/:id`, `POST /channels/:id/archive`, `POST /channels/:id/unarchive`, `DELETE /channels/:id` | M1 |
| Direct messages | `POST /dms` (user ids, returns the existing DM or creates one) | M1 |
| Membership | `GET /channels/:id/members`, `POST /channels/:id/members`, `DELETE /channels/:id/members/:userId`, `POST /channels/:id/join`, `POST /channels/:id/leave`, `PATCH /channels/:id/me` (notification level, mute, star, section) | M1 |
| Messages | `GET /channels/:id/messages` (`before_seq`, `after_seq`, `around`), `POST /channels/:id/messages` (REST send with `client_msg_id`), `PATCH /messages/:id`, `DELETE /messages/:id`, `GET /messages/:id` | M1 |
| Read state | `PUT /channels/:id/read`, `PUT /messages/:id/unread`, `POST /me/read-all`, `GET /me/unreads` | M1 |
| Presence and status | `GET /presence?ids=`, `PUT /me/status`, `PUT /me/dnd` | M1 |
| Browse | `GET /channels/browse` (public channels, search, join state) | M2 |
| Threads | `GET /messages/:id/replies`, `POST /messages/:id/replies`, `PUT/DELETE /messages/:id/follow`, `GET /threads` | M2 |
| Reactions | `PUT/DELETE /messages/:id/reactions/:emoji` | M2 |
| Pins and saved | `GET/POST/DELETE /channels/:id/pins`, `GET /me/saved`, `PUT/DELETE /me/saved/:messageId` | M2 |
| Files | `POST /uploads` (signed URL), `POST /uploads/:id/complete`, `GET /files/:id` (signed download), `GET /channels/:id/files` | M2 |
| Search | `GET /search/messages`, `GET /search/files` | M3 |
| Sidebar | `GET/POST/PATCH/DELETE /me/sidebar-sections`, `PUT /me/sidebar-order` | M3 |
| Notification preferences | `GET/PUT /me/notification-preferences` (extends the shared endpoint) | M3 |
| Space channels | `GET /spaces/:id/channel`, `GET/PUT /channels/:id/activity-rules` | M4 |
| Integration | `POST /messages/:id/create-work-item`, `GET /items/:ref/card` (permission-aware unfurl data) | M4 |
| Slash commands | `GET /commands`, `POST /commands/execute` | M4 |
| Webhooks | `POST /channels/:id/webhooks`, `DELETE /webhooks/:id`, `POST /hooks/:token` (public ingest) | M5 |
| Admin | `GET/PUT /admin/messaging-settings`, `POST /admin/export`, `GET /admin/export/:id` | M5 |

**Conventions**

- Message history is paged by `seq`, never by offset or timestamp
- Every message response includes `seq`, `client_msg_id` (when present) and the channel's current `last_seq`
- `POST /channels/:id/messages` and the socket `message:send` are idempotent on `(channel_id, client_msg_id)`
- Mutations write `audit_logs` where the foundation brief requires it (channel creation, membership changes, archive, delete, admin message deletion)
- Public ingest endpoints (`/hooks/:token`) are rate limited, accept only JSON, and post as a webhook bot

## 11. Phased build plan

Six phases, labeled M1 to M6 so they do not clash with the foundation (numbered phases) or work items (W1 to W7) briefs. **Prerequisites:** foundation Phases 0 to 5 and work items W1 to W3. M4 also needs the work items board and, for sprint events, W6. Do not start a phase until the previous one meets its done criteria.

### M1: Real-time core

- Migrations for the section 3 tables needed here, with row-level security and tenant-isolation tests
- Realtime gateway service: handshake with tenant resolution, rooms, Redis adapter, `message:send` with acknowledgement, idempotency, `sync` after reconnect, revoke on logout or deactivation
- Channels (public, private), DMs and group DMs, membership, message history by `seq`, edit and delete with tombstones
- Read cursors and unread counts, basic presence and typing
- `#general` and `#announcements` created at tenant provisioning, with default-channel auto-join
- Messages area with the conversation list, conversation view, basic composer, and the new permissions in `can()`
- **Done when:** two people in different browsers chat in real time, messages survive reconnects without loss or duplicates, unread counts are correct across two tabs, and the socket isolation tests pass

### M2: Rich messaging

- Threads and the thread panel, reactions, mentions with autocomplete, pins, saved items
- Files with signed uploads, previews and thumbnails, plus link previews with SSRF protection
- Channel browser, channel details, archive and unarchive, message actions menu, announcement channels
- **Done when:** the behavior in section 5 works end to end, and uploads and downloads are tenant and channel scoped

### M3: Search and notifications

- Full-text search with filters and access rules inside the query
- Notifications: in-app inbox, desktop, email after delay, preferences, channel levels, mute, do not disturb and quiet hours
- Threads page, custom sidebar sections, quick switcher
- **Done when:** a user finds old messages quickly without ever seeing inaccessible ones, and notification rules match section 7, including never notifying the author

### M4: Platform integration

- Space channels with synced membership, nightly reconciliation and audit entries
- Work item unfurls, create work item from a message, activity bot with rules and coalescing
- Slash command registry with `/task`, `/status`, `/dnd`, and `/checkin` and `/checkout` if the check-in module exists
- Check-in badges, profile popover, docked chat panel on board pages
- **Done when:** adding someone to a space puts them in its channel within seconds, removing them takes access away at once, and a message can become a work item with a link back

### M5: Admin and extensibility

- Tenant messaging settings, retention workers, plan limits, data export
- Incoming webhooks and the basic bot framework
- CRM "Open channel" action if the CRM module exists
- **Done when:** an admin can configure the tenant's messaging rules, retention purges expired data, and a webhook can post into a channel

### M6: Hardening

- Load test with thousands of concurrent sockets across several tenants, and fix hot spots
- Reconnect and failure testing: dropped connections, Redis restarts, duplicate sends
- Accessibility and keyboard pass, mobile layout pass, empty and error states everywhere, demo seed data
- Playwright end-to-end tests: send and receive, threads, upload, search, space sync, and a cross-tenant socket attack attempt
- **Done when:** the end-to-end suite passes in CI, the load test meets agreed targets, and the isolation tests pass

**Later, not part of this build:** polls, scheduled messages and reminders, async standups, huddles and calls through an integration, canvas or shared notes, mobile push, and a third-party app directory.

## 12. Definition of done and open decisions

Every phase is done only when all of the following hold.

- Lint, type-check and tests pass in CI
- New endpoints and socket events have permission tests (allowed and denied) and cross-tenant tests
- New screens have loading, empty and error states, work with the keyboard, and shared components appear on the `/design` page
- Real-time behavior is covered by tests that run two or more clients, including a reconnect case
- Migrations are reversible and the demo seed data still works
- `CHANGELOG.md` and `DECISIONS.md` are updated

**Open decisions to settle before M1**

- [ ] Transport: Socket.IO with the Redis adapter (assumed) or plain `ws` with a custom protocol
- [ ] Gateway deployment: a separate service (assumed) or inside the API process for the first release
- [ ] File storage for attachments: S3-compatible bucket, or storage on an existing VM (same decision as the work items module)
- [ ] Search engine: Postgres full-text (assumed) now, with a trigger point for moving to Meilisearch or OpenSearch
- [ ] Message body format: Tiptap JSON subset (assumed) or Markdown
- [ ] Can org admins read private channels for compliance, or never (assumed: never in this build)
- [ ] Default retention: keep forever (assumed), or a default number of days
- [ ] DM restrictions between members of the same tenant: none (assumed), or admin-controlled later
- [ ] Message edit window: unlimited (assumed), or a time limit
- [ ] Mobile: responsive web only for now (assumed), with native push planned later

## 13. Prompts to give Claude

Save this brief as `docs/MESSAGING-BRIEF.md` next to the foundation and work items briefs, then paste the kickoff prompt into Claude Code. Use the messaging UI prompt alongside it, or save it as `docs/MESSAGING-UI.md`.

### Kickoff prompt

```markdown
You are the lead engineer extending our multi-tenant company platform with a native messaging module: channels, DMs, threads and real-time delivery, integrated with spaces and work items.

Read docs/BRIEF.md (foundation), docs/WORK-ITEMS-BRIEF.md and docs/MESSAGING-BRIEF.md fully before doing anything. The earlier briefs' rules, tech stack, multi-tenancy model, permission module and design system apply to this module unchanged.

Rules:
- Confirm the prerequisites in section 1 of the messaging brief are complete (foundation Phases 0 to 5, work items W1 to W3). If not, stop and tell me what is missing.
- Build one phase at a time (M1 to M6), in order. Do not start a phase until the previous one meets its done criteria.
- Respect the non-goals in section 1. If something is not in the brief, ask before adding it.
- Persist first, publish second: a message is acknowledged only after it is stored. Sends are idempotent on (channel_id, client_msg_id). Clients order by seq.
- Tenant isolation is critical. Every table has org_id and row-level security. Room names, Redis keys, queue jobs and storage keys carry the tenant id. Never accept a channel or room id from a client without checking tenant and membership on the server.
- The REST API and the realtime gateway must call the same service functions and the same can(user, action, resource) module.
- Write real-time tests that run two or more clients, including reconnect and cross-tenant attack cases.
- Use shadcn/ui, Tiptap, TanStack Query and Virtual. Reuse shared components, and add new ones to the /design page first.
- Before writing code for a phase, reply with a short plan: migrations, services, events, endpoints, screens, risks. Wait for my approval.
- Small commits. Run lint, type-check and tests before saying a task is done. Update docs/CHANGELOG.md and docs/DECISIONS.md.
- When the brief is ambiguous, list the options with a recommendation and ask.

Start with M1. First list any open decisions from section 12 that block it, then give me the M1 plan.
```

### Messaging UI prompt

```markdown
Build the messaging screens to the quality of Slack: fast, calm, keyboard-friendly, and satisfying to use all day. People will spend hours here, so small details matter.

Layout
- A Messages area inside the existing app shell. A conversation list with sections (Threads, Mentions and reactions, Saved, Starred, Channels, Direct messages, custom sections), a center conversation, and a collapsible right panel for threads, channel details and profiles.
- Unread channels are bold, mentions and DMs show count badges, and a Jump to unread pill appears when scrolled away from new messages.

Conversation
- Virtualized message list that stays smooth with 10,000 messages. Grouped consecutive messages, date separators, a New messages divider, and a floating hover toolbar (react, reply in thread, more).
- Pending messages are slightly dimmed, failed ones show a red retry bar. Incoming messages animate in subtly and never move the view while someone reads history.
- Rich composer: formatting bar, emoji, @mentions, #channels, work item keys, slash command autocomplete, file drag and drop, image paste, typing indicator, Enter to send, Shift+Enter for a new line.
- Threads open in the right panel with an Also send to channel option. Reactions use a searchable emoji picker with recents.
- Rich cards for work item unfurls and link previews. Reserve space so nothing shifts when they load. Bot messages are quiet and carry a bot badge.

Details
- Avatars with a presence dot, custom status, and a small check-in badge (onsite, remote, offsite, on leave). Profile popover with title, groups, local time and actions.
- Quick switcher on Ctrl/Cmd+K, next and previous unread with Alt+Shift+Up and Down, Up arrow in an empty composer edits the last message, Esc closes panels.
- Image lightbox with arrow keys, code blocks with highlighting and a copy button.
- A quiet banner when reconnecting. Never lose a draft.

Visual language
- Neutral palette with the tenant accent used sparingly. Light and dark themes. 14px base text, 13px in dense areas, and a comfortable and compact density toggle.

Quality
- Skeletons shaped like messages, helpful empty states, friendly errors, visible focus, WCAG AA contrast, screen-reader announcements for new messages in the open conversation.
- Responsive: on tablet the right panel overlays, on mobile the list and the conversation are separate screens, panels are full-screen sheets, and the composer stays above the keyboard.

Before building the full screens, add the message row, composer, conversation list item, thread panel, unfurl card and profile popover to the /design page in both themes, and get my approval of them.
```
