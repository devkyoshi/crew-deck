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
  /** For direct messages: the other people (everyone but the caller, or the caller for a self-DM). */
  people?: PersonDTO[];
}

/** A channel as it appears in the caller's own list. */
export interface MyChannelDTO extends ChannelDTO {
  role: 'owner' | 'member';
  notificationLevel: NotificationLevel;
  mutedUntil: string | null;
  isStarred: boolean;
  lastReadSeq: number;
  unread: number;
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
  presenceUpdate: 'presence:update',
  sync: 'sync',
} as const;

/** Server to client. */
export const S2C = {
  messageNew: 'message:new',
  messageUpdated: 'message:updated',
  messageDeleted: 'message:deleted',
  typing: 'typing',
  presenceChanged: 'presence:changed',
  channelUpdated: 'channel:updated',
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
});
export const messageEditSchema = z.object({ messageId: uuid, body: z.unknown() });
export const messageDeleteSchema = z.object({ messageId: uuid });
export const typingSchema = z.object({ channelId: uuid });
export const readUpdateSchema = z.object({ channelId: uuid, seq: z.number().int().min(0) });
export const presenceUpdateSchema = z.object({ state: z.enum(['active', 'away']) });
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
