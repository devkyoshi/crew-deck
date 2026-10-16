import type { ItemCardDTO } from '@crew-deck/shared';
import type { TenantDb } from '../db/client.js';
import type { MessageDoc } from '../db/types.js';
import type { Actor } from '../permissions/can.js';
import { resolveItem, type ItemRow } from '../work/service.js';

/** The most item cards one message shows. */
export const MAX_ITEM_LINKS = 5;

const KEY_RE = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,7})\b/g;

/** Strings in a message that can name an item: its text and the address of every link in it. */
function strings(node: unknown, out: string[]) {
  if (!node || typeof node !== 'object') return;
  const n = node as { text?: unknown; marks?: unknown; content?: unknown };
  if (typeof n.text === 'string') out.push(n.text);
  if (Array.isArray(n.marks))
    for (const m of n.marks as { type?: string; attrs?: { href?: unknown } }[])
      if (m.type === 'link' && typeof m.attrs?.href === 'string') out.push(m.attrs.href);
  if (Array.isArray(n.content)) for (const c of n.content) strings(c, out);
}

/** Item keys (`ENG-142`) written in a message or contained in a link to an item, in order, without repeats. */
export function itemKeysIn(doc: unknown, text: string): string[] {
  const all = [text];
  strings(doc, all);
  const seen = new Set<string>();
  for (const s of all) {
    for (const m of s.matchAll(KEY_RE)) {
      seen.add(`${m[1]}-${Number(m[2])}`);
      if (seen.size >= MAX_ITEM_LINKS) return [...seen];
    }
  }
  return [...seen];
}

/**
 * Remembers which items a message shows cards for (only ids: the cards read live data and are checked
 * against each viewer). Keys that name nothing in this workspace are ignored. Replaces earlier links, so
 * an edit that removes a key removes its card.
 */
export async function storeItemLinks(
  tx: TenantDb,
  msg: Pick<MessageDoc, 'id' | 'channelId'>,
  keys: string[],
  itemIds: string[] = [],
) {
  await tx.messageLinks.deleteMany({ messageId: msg.id });
  const found = new Map<string, string>(); // itemId -> key
  const bySpace = new Map<string, number[]>();
  for (const k of keys) {
    const [space, num] = k.split('-') as [string, string];
    bySpace.set(space, [...(bySpace.get(space) ?? []), Number(num)]);
  }
  if (bySpace.size) {
    const spaces = await tx.spaces.find({ key: { $in: [...bySpace.keys()] }, deletedAt: null });
    for (const sp of spaces) {
      const items = await tx.workItems.find({
        spaceId: sp.id,
        number: { $in: bySpace.get(sp.key)! },
        deletedAt: null,
      });
      for (const it of items) found.set(it.id, `${sp.key}-${it.number}`);
    }
  }
  const extra = itemIds.filter((id) => !found.has(id));
  if (extra.length) {
    const items = await tx.workItems.find({ id: { $in: extra }, deletedAt: null });
    const spaces = await tx.spaces.find({ id: { $in: items.map((i) => i.spaceId) } });
    const keyOf = new Map(spaces.map((s) => [s.id, s.key]));
    for (const it of items) found.set(it.id, `${keyOf.get(it.spaceId) ?? '?'}-${it.number}`);
  }
  const rows = [...found].slice(0, MAX_ITEM_LINKS).map(([itemId, itemKey]) => ({
    messageId: msg.id,
    channelId: msg.channelId,
    itemId,
    itemKey,
  }));
  if (rows.length) await tx.messageLinks.insert(rows);
}

/**
 * The card for one item as this person may see it. Someone who cannot open the item's space gets a
 * neutral card with only the key they already had in front of them: no title, no details, and the same
 * answer as for an item that does not exist, so cards cannot be used to probe.
 */
export async function itemCard(t: TenantDb, actor: Actor, ref: string): Promise<ItemCardDTO> {
  try {
    const { row, space } = await resolveItem(t, actor, ref);
    return cardOf(row, space.key);
  } catch {
    return { access: false, key: ref };
  }
}

/** The card for an item the caller is already known to see. */
export function cardOf(row: ItemRow, spaceKey: string): ItemCardDTO {
  return {
    access: true,
    id: row.id,
    key: `${spaceKey}-${row.number}`,
    spaceKey,
    title: row.title,
    type: row.type,
    status: { name: row.statusName, category: row.statusCategory, color: row.statusColor ?? null },
    priority: row.priority,
    assignee: row.assigneeId
      ? { id: row.assigneeId, name: row.assigneeName, avatarUrl: row.assigneeAvatar }
      : null,
    href: `/spaces/${spaceKey}/items/${spaceKey}-${row.number}`,
  };
}
