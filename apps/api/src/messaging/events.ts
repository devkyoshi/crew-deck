import { Emitter } from '@socket.io/redis-emitter';
import type { Redis } from 'ioredis';

/**
 * Rooms are tenant-prefixed (brief section 2): a channel id from a client is never enough to reach a
 * room, because the tenant is part of the name and the server decides who is in it.
 */
export const channelRoom = (orgId: string, channelId: string) =>
  `org:${orgId}:channel:${channelId}`;
export const userRoom = (orgId: string, userId: string) => `org:${orgId}:user:${userId}`;
/** Every connected member of a workspace; carries presence changes. */
export const orgRoom = (orgId: string) => `org:${orgId}:all`;
/** One browser session (by the hash of its cookie), so logging out ends only that session's sockets. */
export const sessionRoom = (orgId: string, sessionHash: string) =>
  `org:${orgId}:sess:${sessionHash}`;

/**
 * How the API (and the gateway) push things to connected clients. Persist first, publish second:
 * services call this only after the change is stored.
 */
export interface EventSink {
  toChannel(orgId: string, channelId: string, event: string, payload: unknown): void;
  toUser(orgId: string, userId: string, event: string, payload: unknown): void;
  toOrg(orgId: string, event: string, payload: unknown): void;
  /** Puts every socket of the user into a channel's room (they were added or joined). */
  joinChannel(orgId: string, userId: string, channelId: string): void;
  /** Takes every socket of the user out of the room at once (they were removed or left). */
  leaveChannel(orgId: string, userId: string, channelId: string): void;
  /** Disconnects all of the user's sockets (deactivation, role change). */
  disconnectUser(orgId: string, userId: string): void;
  /** Disconnects the sockets of one session (logout). */
  disconnectSession(orgId: string, sessionHash: string): void;
}

/** Publishes through Redis; the gateway's Socket.IO Redis adapter delivers to the sockets it holds. */
export class RedisEventSink implements EventSink {
  private readonly emitter: Emitter;

  constructor(redis: Redis) {
    this.emitter = new Emitter(redis);
  }

  toChannel(orgId: string, channelId: string, event: string, payload: unknown) {
    this.emitter.to(channelRoom(orgId, channelId)).emit(event, payload);
  }
  toUser(orgId: string, userId: string, event: string, payload: unknown) {
    this.emitter.to(userRoom(orgId, userId)).emit(event, payload);
  }
  toOrg(orgId: string, event: string, payload: unknown) {
    this.emitter.to(orgRoom(orgId)).emit(event, payload);
  }
  joinChannel(orgId: string, userId: string, channelId: string) {
    this.emitter.in(userRoom(orgId, userId)).socketsJoin(channelRoom(orgId, channelId));
  }
  leaveChannel(orgId: string, userId: string, channelId: string) {
    this.emitter.in(userRoom(orgId, userId)).socketsLeave(channelRoom(orgId, channelId));
  }
  disconnectUser(orgId: string, userId: string) {
    this.emitter.in(userRoom(orgId, userId)).disconnectSockets(true);
  }
  disconnectSession(orgId: string, sessionHash: string) {
    this.emitter.in(sessionRoom(orgId, sessionHash)).disconnectSockets(true);
  }
}

export const nullEvents: EventSink = {
  toChannel() {},
  toUser() {},
  toOrg() {},
  joinChannel() {},
  leaveChannel() {},
  disconnectUser() {},
  disconnectSession() {},
};

/** Records what was published (tests). */
export class MemoryEventSink implements EventSink {
  readonly log: {
    kind: string;
    orgId: string;
    target: string;
    event?: string;
    payload?: unknown;
  }[] = [];
  toChannel(orgId: string, channelId: string, event: string, payload: unknown) {
    this.log.push({ kind: 'channel', orgId, target: channelId, event, payload });
  }
  toUser(orgId: string, userId: string, event: string, payload: unknown) {
    this.log.push({ kind: 'user', orgId, target: userId, event, payload });
  }
  toOrg(orgId: string, event: string, payload: unknown) {
    this.log.push({ kind: 'org', orgId, target: orgId, event, payload });
  }
  joinChannel(orgId: string, userId: string, channelId: string) {
    this.log.push({ kind: 'join', orgId, target: `${userId}:${channelId}` });
  }
  leaveChannel(orgId: string, userId: string, channelId: string) {
    this.log.push({ kind: 'leave', orgId, target: `${userId}:${channelId}` });
  }
  disconnectUser(orgId: string, userId: string) {
    this.log.push({ kind: 'disconnect', orgId, target: userId });
  }
  disconnectSession(orgId: string, sessionHash: string) {
    this.log.push({ kind: 'disconnect-session', orgId, target: sessionHash });
  }
}
