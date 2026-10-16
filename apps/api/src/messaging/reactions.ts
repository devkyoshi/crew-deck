import { MAX_REACTION_EMOJI, S2C, type ReactionDTO, type ReactionEvent } from '@crew-deck/shared';
import { AppError, notFound } from '../lib/errors.js';
import type { Actor } from '../permissions/can.js';
import { requireChannel } from './access.js';
import type { MessagingCtx } from './context.js';
import { groupReactions } from './dto.js';
import { loadMessage } from './messages.js';

// Pictures, regional indicators (flags), skin tones, and the joiners that glue them together:
// zero-width joiner, variation selector 16 and the keycap mark (with its digit, # or *).
const EMOJI_CHARS =
  /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|‍|️|⃣|[#*0-9])+$/u;
const HAS_PICTURE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

/** A reaction is an emoji (with skin tones, flags and joined sequences), never arbitrary text. */
export const isEmoji = (v: string) =>
  v.length > 0 && v.length <= 32 && EMOJI_CHARS.test(v) && HAS_PICTURE.test(v);

/**
 * Adds, removes or (with no `desired`) toggles my reaction. Members can react in any channel they are
 * in that is not archived, announcement channels included. At most 50 distinct emoji per message.
 */
export async function toggleReaction(
  ctx: MessagingCtx,
  actor: Actor,
  messageId: string,
  emoji: string,
  desired?: boolean,
): Promise<ReactionDTO[]> {
  if (!isEmoji(emoji))
    throw new AppError(422, 'bad_emoji', 'That is not an emoji', { emoji: 'Choose an emoji' });
  const t = ctx.db.tenant(actor.orgId);
  const { msg, access } = await loadMessage(t, actor, messageId);
  if (msg.deletedAt || msg.kind === 'system') throw notFound('Message');
  requireChannel(actor, access, 'message.react');

  const mine = await t.messageReactions.findOne({ messageId, userId: actor.userId, emoji });
  const on = desired ?? !mine;
  if (on && !mine) {
    const distinct = await t.messageReactions.distinct('emoji', { messageId });
    if (distinct.length >= MAX_REACTION_EMOJI && !distinct.includes(emoji)) {
      throw new AppError(
        422,
        'too_many_reactions',
        `A message can have up to ${MAX_REACTION_EMOJI} different emoji`,
      );
    }
    await t.messageReactions.insertIgnore({
      channelId: msg.channelId,
      messageId,
      userId: actor.userId,
      emoji,
    });
  } else if (!on && mine) {
    await t.messageReactions.deleteOne({ messageId, userId: actor.userId, emoji });
  }
  const reactions = groupReactions(await t.messageReactions.find({ messageId }));
  ctx.events.toChannel(actor.orgId, msg.channelId, S2C.reactionUpdated, {
    channelId: msg.channelId,
    messageId,
    reactions,
  } satisfies ReactionEvent);
  return reactions;
}
