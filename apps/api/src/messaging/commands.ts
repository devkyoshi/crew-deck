import type { CommandResult, SlashCommandDTO } from '@crew-deck/shared';
import type { TenantDb } from '../db/client.js';
import { loadSettings } from '../checkin/service.js';
import { AppError, notFound } from '../lib/errors.js';
import type { Actor } from '../permissions/can.js';
import { loadVisibleSpaces } from '../spaces/access.js';
import { loadItemRows } from '../work/service.js';
import { loadChannel } from './access.js';
import type { MessagingCtx } from './context.js';
import { cardOf, itemCard } from './item-links.js';
import { setCustomStatus, setDoNotDisturb } from './me.js';

interface RunContext {
  ctx: MessagingCtx;
  actor: Actor;
  t: TenantDb;
  /** The conversation the person is typing in (null in places without one). */
  channelId: string | null;
  /** Everything after the command name. */
  args: string;
}

interface Command extends SlashCommandDTO {
  /** Hidden from autocomplete and refused when a module the command needs is off for the workspace. */
  available?: (t: TenantDb) => Promise<boolean>;
  run: (c: RunContext) => Promise<CommandResult>;
}

const usage = (text: string): never => {
  throw new AppError(422, 'bad_command', text);
};

/** `30`, `30m`, `2h`, `1d` → minutes. */
export function parseDuration(input: string): number | null {
  const m = /^(\d{1,4})\s*(m|min|mins|h|hr|hrs|d|day|days)?$/i.exec(input.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? 'm').toLowerCase();
  const minutes = unit.startsWith('h') ? n * 60 : unit.startsWith('d') ? n * 1440 : n;
  return minutes >= 1 && minutes <= 60 * 24 * 7 ? minutes : null;
}

const KEY = /^[A-Za-z][A-Za-z0-9]{1,9}-\d+$/;
const LOCATIONS = ['onsite', 'remote', 'offsite'] as const;

const checkinOn = async (t: TenantDb) => (await loadSettings(t)).checkinEnabled;

const COMMANDS: Command[] = [
  {
    name: 'task',
    description: 'Create a work item, show one, or list your open work',
    usage: '/task create <title>  ·  /task ENG-142  ·  /task mine',
    async run({ actor, t, channelId, args }) {
      const [first = '', ...rest] = args.trim().split(/\s+/);
      const word = first.toLowerCase();
      if (word === 'create') {
        const title = rest.join(' ').trim();
        if (!title) usage('Give the work item a title: /task create <title>');
        let spaceId: string | null = null;
        if (channelId) {
          const { channel } = await loadChannel(t, actor, channelId);
          spaceId = channel.spaceId;
        }
        return { kind: 'open_create', title, spaceId };
      }
      if (word === 'mine') {
        const spaces = await loadVisibleSpaces(t, actor);
        const keyOf = new Map(spaces.map((s) => [s.id, s.key]));
        const rows = await loadItemRows(
          t,
          { assigneeId: actor.userId, deletedAt: null, spaceId: { $in: [...keyOf.keys()] } },
          { sort: { updatedAt: -1 }, limit: 40 },
        );
        const open = rows.filter((r) => r.statusCategory !== 'done').slice(0, 10);
        if (open.length === 0) return { kind: 'ephemeral', text: 'You have no open work items.' };
        return {
          kind: 'ephemeral',
          text: `Your open work (${open.length}${rows.length >= 40 ? '+' : ''}):`,
          cards: open.map((r) => cardOf(r, keyOf.get(r.spaceId)!)),
        };
      }
      if (KEY.test(first)) {
        const card = await itemCard(t, actor, first.toUpperCase());
        return card.access
          ? { kind: 'ephemeral', text: card.key, card }
          : { kind: 'ephemeral', text: `You do not have access to ${card.key}, or it does not exist.` };
      }
      return usage('Use /task create <title>, /task ENG-142 or /task mine');
    },
  },
  {
    name: 'status',
    description: 'Set your status (or clear it)',
    usage: '/status <emoji> <text>  ·  /status clear',
    async run({ ctx, actor, args }) {
      const text = args.trim();
      if (!text) usage('Say what you are up to: /status 🎧 Heads down');
      if (text.toLowerCase() === 'clear') {
        await setCustomStatus(ctx, actor, { emoji: null, text: null });
        return { kind: 'done', text: 'Status cleared.' };
      }
      const [first = '', ...rest] = text.split(/\s+/);
      // An emoji first, then the words. Without an emoji the whole text is the status.
      const hasEmoji = /\p{Extended_Pictographic}/u.test(first) && first.length <= 16;
      const words = (hasEmoji ? rest.join(' ') : text).slice(0, 100);
      if (!words) usage('Add a few words after the emoji: /status 🎧 Heads down');
      await setCustomStatus(ctx, actor, { emoji: hasEmoji ? first : '💬', text: words });
      return { kind: 'done', text: `Status set: ${hasEmoji ? first : '💬'} ${words}` };
    },
  },
  {
    name: 'dnd',
    description: 'Pause notifications for a while',
    usage: '/dnd <30m | 2h | 1d>  ·  /dnd off',
    async run({ ctx, actor, args }) {
      const text = args.trim().toLowerCase();
      if (text === 'off' || text === 'end' || text === 'stop') {
        await setDoNotDisturb(ctx, actor, null);
        return { kind: 'done', text: 'Do not disturb is off.' };
      }
      const minutes = parseDuration(text || '60');
      if (!minutes) usage('How long? For example /dnd 30m, /dnd 2h or /dnd 1d');
      const until = await setDoNotDisturb(ctx, actor, minutes);
      return {
        kind: 'done',
        text: until ? `Do not disturb until ${new Date(until).toLocaleTimeString()}.` : 'Do not disturb is on.',
      };
    },
  },
  {
    name: 'checkin',
    description: 'Check in for the day',
    usage: '/checkin <onsite | remote | offsite> [note]',
    available: checkinOn,
    async run({ args }) {
      const [loc = '', ...rest] = args.trim().split(/\s+/);
      const locationType = LOCATIONS.find((l) => l === loc.toLowerCase());
      if (!locationType) usage('Where are you working? /checkin onsite, remote or offsite');
      const note = rest.join(' ').trim();
      return {
        kind: 'call',
        method: 'POST',
        path: '/checkin',
        body: { locationType, ...(note ? { note } : {}) },
        text: `Checked in (${locationType}).`,
      };
    },
  },
  {
    name: 'checkout',
    description: 'Check out for the day',
    usage: '/checkout [note]',
    available: checkinOn,
    async run({ args }) {
      const note = args.trim();
      return {
        kind: 'call',
        method: 'POST',
        path: '/checkout',
        body: note ? { note } : {},
        text: 'Checked out.',
      };
    },
  },
];

/** The commands this person can use here (a module that is switched off hides its commands). */
export async function listCommands(ctx: MessagingCtx, actor: Actor): Promise<SlashCommandDTO[]> {
  const t = ctx.db.tenant(actor.orgId);
  const out: SlashCommandDTO[] = [];
  for (const c of COMMANDS) {
    if (c.available && !(await c.available(t))) continue;
    out.push({ name: c.name, description: c.description, usage: c.usage });
  }
  return out;
}

/**
 * Runs a slash command as the caller. Replies are for the caller alone (nothing is posted to the channel)
 * and use the same rights and services as the rest of the app.
 */
export async function executeCommand(
  ctx: MessagingCtx,
  actor: Actor,
  input: { name: string; args: string; channelId?: string | null },
): Promise<CommandResult> {
  const t = ctx.db.tenant(actor.orgId);
  const command = COMMANDS.find((c) => c.name === input.name.toLowerCase());
  if (!command || (command.available && !(await command.available(t)))) throw notFound('Command');
  return command.run({ ctx, actor, t, channelId: input.channelId ?? null, args: input.args });
}
