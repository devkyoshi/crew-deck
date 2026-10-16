import { z } from 'zod';

/**
 * Messaging contract shared by the API, the realtime gateway and the web app
 * (docs/Messaging Module Build Brief.md, sections 3 and 6).
 */

export const CHANNEL_TYPES = ['public', 'private', 'dm', 'group_dm'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const MAX_MESSAGE_CHARS = 4000;
export const GROUP_DM_MAX = 8;
export const HISTORY_PAGE = 50;
export const SYNC_LIMIT = 200;
/** After this long without an acknowledgement a sent message shows as failed. */
export const SEND_TIMEOUT_MS = 10_000;

export const CHANNEL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
export const channelNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(CHANNEL_NAME_RE, 'Use lowercase letters, numbers and hyphens (up to 80 characters)');

export const NOTIFICATION_LEVELS = ['all', 'mentions', 'none'] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

export const PRESENCE_STATES = ['online', 'away', 'dnd', 'offline'] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];

export type MessageKind = 'user' | 'system' | 'bot';

/** Most distinct emoji one message can carry, and files one message can carry. */
export const MAX_REACTION_EMOJI = 50;
export const MAX_FILES_PER_MESSAGE = 10;
/** In channels with more members than this, only admins may use @channel and @here (default). */
export const BROADCAST_MENTION_LIMIT = 50;

export interface ReactionDTO {
  emoji: string;
  count: number;
  /** Who reacted (the first 100), so a client can tell whether it did. */
  userIds: string[];
}

export interface AttachmentDTO {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** A real PNG, JPEG, GIF or WebP: shown inline. Everything else downloads. */
  isImage: boolean;
  /** Same-origin address. Every download is checked against the person's access to the channel. */
  url: string;
}

export interface LinkPreviewDTO {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
}

export type MentionTarget =
  { type: 'user' | 'group'; id: string } | { type: 'channel' | 'here'; id: 'channel' | 'here' };

export interface PersonDTO {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  /** Set when the person's membership was deactivated; their messages stay. */
  deactivated?: boolean;
}

/** A message as every client sees it. A deleted message is a tombstone: `body` and `bodyText` are null. */
export interface MessageDTO {
  id: string;
  channelId: string;
  seq: number;
  kind: MessageKind;
  authorId: string | null;
  author: PersonDTO | null;
  body: unknown | null;
  bodyText: string | null;
  clientMsgId: string | null;
  threadRootId: string | null;
  alsoInChannel: boolean;
  replyCount: number;
  lastReplyAt: string | null;
  /** Up to three people who replied, for the avatars under the root message. */
  replyAuthors: PersonDTO[];
  reactions: ReactionDTO[];
  attachments: AttachmentDTO[];
  pinned: boolean;
  mentions: MentionTarget[];
  previews: LinkPreviewDTO[];
  /** Links are being looked up: the client reserves room for the cards. */
  previewsPending: boolean;
  /** Work items named in the message (key or link). Their cards are read live, per viewer. */
  workItems: { id: string; key: string }[];
  /** For bot messages: who posted. */
  bot: { id: string; name: string } | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface ChannelDTO {
  id: string;
  type: ChannelType;
  name: string | null;
  topic: string | null;
  description: string | null;
  spaceId: string | null;
  isAnnouncement: boolean;
  isArchived: boolean;
  lastSeq: number;
  lastMessageAt: string | null;
  createdAt: string;
  memberCount: number;
  /** Days messages are kept here, when the channel has its own setting (null: the workspace default). */
  retentionDays: number | null;
  /** The CRM deal or company this channel follows, if any. */
  crm: { type: 'deal' | 'company'; id: string } | null;
  /** For direct messages: the other people (everyone but the caller, or the caller for a self-DM). */
  people?: PersonDTO[];
  /** True when the caller can read but not post (a space viewer in a space's channel). */
  readOnly?: boolean;
}

/** A channel as it appears in the caller's own list. */
export interface MyChannelDTO extends ChannelDTO {
  role: 'owner' | 'member';
  notificationLevel: NotificationLevel;
  mutedUntil: string | null;
  isStarred: boolean;
  /** The person's own sidebar section this channel sits in, if any. */
  sectionId: string | null;
  lastReadSeq: number;
  unread: number;
  /** Unread messages that mention me, @channel or @here. */
  mentionCount: number;
}

// ---- Socket events ----------------------------------------------------------------------------------

export const SOCKET_PATH = '/realtime/socket.io';

/** Client to server. */
export const C2S = {
  messageSend: 'message:send',
  messageEdit: 'message:edit',
  messageDelete: 'message:delete',
  typingStart: 'typing:start',
  readUpdate: 'read:update',
  reactionToggle: 'reaction:toggle',
  presenceUpdate: 'presence:update',
  viewUpdate: 'view:update',
  sync: 'sync',
} as const;

/** Server to client. */
export const S2C = {
  messageNew: 'message:new',
  messageUpdated: 'message:updated',
  messageDeleted: 'message:deleted',
  reactionUpdated: 'reaction:updated',
  threadUpdated: 'thread:updated',
  typing: 'typing',
  presenceChanged: 'presence:changed',
  channelUpdated: 'channel:updated',
  notificationNew: 'notification:new',
  channelMembership: 'channel:membership',
  readSynced: 'read:synced',
  error: 'error',
} as const;

export const SOCKET_ERROR_CODES = [
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'CHANNEL_ARCHIVED',
  'VALIDATION',
] as const;
export type SocketErrorCode = (typeof SOCKET_ERROR_CODES)[number];

export type Ack<T> = { ok: true; data: T } | { ok: false; code: SocketErrorCode; message: string };

const uuid = z.string().uuid();

export const messageSendSchema = z.object({
  channelId: uuid,
  clientMsgId: z.string().min(8).max(64),
  body: z.unknown(),
  attachmentIds: z.array(uuid).max(MAX_FILES_PER_MESSAGE).optional(),
  /** Set to reply in a thread. Threads do not nest: this must be a top-level message. */
  threadRootId: uuid.optional(),
  alsoInChannel: z.boolean().optional(),
});
export const reactionToggleSchema = z.object({ messageId: uuid, emoji: z.string().min(1).max(32) });
export const messageEditSchema = z.object({ messageId: uuid, body: z.unknown() });
export const messageDeleteSchema = z.object({ messageId: uuid });
export const typingSchema = z.object({ channelId: uuid });
export const readUpdateSchema = z.object({ channelId: uuid, seq: z.number().int().min(0) });
export const presenceUpdateSchema = z.object({ state: z.enum(['active', 'away']) });
/** The conversation the person is looking at right now (window focused), or null. */
export const viewUpdateSchema = z.object({ channelId: uuid.nullable() });
export const syncSchema = z.object({
  channels: z.array(z.object({ channelId: uuid, lastSeq: z.number().int().min(0) })).max(200),
});

export type SyncResult = {
  channelId: string;
  /** Messages after the client's `lastSeq`, oldest first. */
  messages: MessageDTO[];
  /** True when more than SYNC_LIMIT were missed: the client refetches through REST. */
  refetch: boolean;
  lastSeq: number;
}[];

export interface TypingEvent {
  channelId: string;
  userId: string;
}
export interface PresenceEvent {
  userId: string;
  state: PresenceState;
}
export interface ReadSyncedEvent {
  channelId: string;
  seq: number;
}
export interface MembershipEvent {
  channelId: string;
  /** 'added' means the user is now in the room; 'removed' means they were taken out. */
  change: 'added' | 'removed';
}

export interface ReactionEvent {
  channelId: string;
  messageId: string;
  reactions: ReactionDTO[];
}
export interface ThreadEvent {
  channelId: string;
  rootId: string;
  replyCount: number;
  lastReplyAt: string | null;
  replyAuthors: PersonDTO[];
}

/** What a send returns: the stored message, and mentioned people who are not in the channel. */
export interface SendResult {
  message: MessageDTO;
  duplicate: boolean;
  notInChannel: PersonDTO[];
}

/** A notification pushed to the person's own tabs. `silent` means do not disturb or quiet hours: no desktop alert. */
export interface NotificationEvent {
  id: string;
  type: string;
  text: string;
  channelId: string | null;
  href: string;
  silent: boolean;
  createdAt: string;
}

export const QUIET_HOURS_DEFAULT = { enabled: false, start: '22:00', end: '07:00' } as const;
export const EMAIL_DELAY_DEFAULT_MINUTES = 15;

export interface SidebarSectionDTO {
  id: string;
  name: string;
  position: number;
}

/** One search hit: the message, its channel, and where the words matched. */
export interface SearchHit {
  message: MessageDTO;
  channel: { id: string; type: ChannelType; name: string | null };
  /** The text around the first match, split so the UI can highlight without parsing HTML. */
  snippet: { text: string; match: boolean }[];
}

export interface ParsedSearch {
  text: string;
  from: string[];
  in: string[];
  before: string | null;
  after: string | null;
  has: ('file' | 'link')[];
  is: 'thread'[];
}

// ---- Platform integration (M4) ----------------------------------------------------------------------

/** The card under a message that names a work item. Access is decided per viewer on the server. */
export type ItemCardDTO =
  | {
      access: true;
      id: string;
      key: string;
      spaceKey: string;
      title: string;
      type: 'epic' | 'story' | 'task' | 'bug' | 'ticket' | 'subtask';
      status: { name: string; category: 'todo' | 'in_progress' | 'done'; color: string | null };
      priority: 'highest' | 'high' | 'medium' | 'low' | 'lowest';
      assignee: { id: string; name: string | null; avatarUrl: string | null } | null;
      href: string;
    }
  /** The person cannot open that space (or the item is gone): no title, no details. */
  | { access: false; key: string };

export const ACTIVITY_EVENT_TYPES = [
  'item_created',
  'item_assigned',
  'item_done',
  'sprint_started',
  'sprint_completed',
  'comment_added',
] as const;
export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];
/** Conservative by default: comments are off, to avoid noise. */
export const ACTIVITY_DEFAULTS: ActivityEventType[] = ['item_created', 'item_done'];
export const ACTIVITY_COALESCE_SECONDS = 60;
export const ACTIVITY_EVENT_LABELS: Record<ActivityEventType, string> = {
  item_created: 'A work item is created',
  item_assigned: 'A work item is assigned',
  item_done: 'A work item is moved to Done',
  sprint_started: 'A sprint starts',
  sprint_completed: 'A sprint is completed',
  comment_added: 'Someone comments on a work item',
};

export interface ActivityRulesDTO {
  eventTypes: ActivityEventType[];
}

export interface SlashCommandDTO {
  name: string;
  description: string;
  /** Shown in autocomplete, for example `/task create <title>`. */
  usage: string;
}

/** What running a command asks the client to do. */
export type CommandResult =
  | { kind: 'ephemeral'; text: string; card?: ItemCardDTO; cards?: ItemCardDTO[] }
  /** Open the create-work-item dialog with these values filled in. */
  | { kind: 'open_create'; title: string; spaceId: string | null }
  /** The client runs this request as the person (their own session and rights), then shows `text`. */
  | { kind: 'call'; method: 'POST'; path: string; body: Record<string, unknown>; text: string }
  | { kind: 'done'; text: string };

export interface CreateFromMessageResult {
  item: { id: string; key: string; spaceKey: string };
  /** The bot's reply in the message's thread, already stored and published. */
  replyId: string;
}

/** Where someone is working today. Status only, never times. */
export type CheckinBadge = 'onsite' | 'remote' | 'offsite' | 'leave';
export const CHECKIN_BADGE_LABELS: Record<CheckinBadge, string> = {
  onsite: 'Onsite',
  remote: 'Remote',
  offsite: 'Offsite',
  leave: 'On leave',
};

/** The card behind a name. */
export interface ProfileCardDTO {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  /** IANA name, so the client can show their local time. */
  timezone: string | null;
  groups: string[];
  status: { emoji: string | null; text: string | null } | null;
  checkin: CheckinBadge | null;
  presence: PresenceState;
  /** Open work items assigned to them in spaces you can see. */
  openItems: number;
}

// ---- Admin settings, retention, export, webhooks (M5) -------------------------------------------------------

export const RETENTION_MIN_DAYS = 1;
export const RETENTION_MAX_DAYS = 3650;

/** The workspace's rules for chat. Only the owner changes them. */
export const messagingSettingsSchema = z.object({
  channelCreation: z.enum(['all', 'admins']),
  broadcastLimit: z.number().int().min(0).max(10_000),
  defaultChannelIds: z.array(z.string().max(64)).max(20),
  retentionDays: z.number().int().min(RETENTION_MIN_DAYS).max(RETENTION_MAX_DAYS).nullable(),
  spaceChannels: z.boolean(),
  announcementDefault: z.boolean(),
  leaveSetsDnd: z.boolean(),
});
export type MessagingSettingsDTO = z.infer<typeof messagingSettingsSchema>;

export const MESSAGING_SETTINGS_DEFAULTS: MessagingSettingsDTO = {
  channelCreation: 'all',
  broadcastLimit: BROADCAST_MENTION_LIMIT,
  defaultChannelIds: [],
  retentionDays: null,
  spaceChannels: true,
  announcementDefault: false,
  leaveSetsDnd: false,
};

export interface MessagingSettingsResponse extends MessagingSettingsDTO {
  /** Names of the default channels, so the screen can show them. */
  defaultChannels: { id: string; name: string }[];
}

export type ExportStatus = 'queued' | 'running' | 'done' | 'failed';
export interface ChatExportDTO {
  id: string;
  status: ExportStatus;
  createdAt: string;
  finishedAt: string | null;
  expiresAt: string | null;
  sizeBytes: number | null;
  counts: { channels: number; messages: number } | null;
  error: string | null;
}

export interface WebhookDTO {
  id: string;
  channelId: string;
  name: string;
  createdAt: string;
  createdBy: { id: string; name: string | null } | null;
  lastUsedAt: string | null;
}

export const MAX_WEBHOOK_TEXT_CHARS = 4000;
export const MAX_WEBHOOKS_PER_CHANNEL = 10;
