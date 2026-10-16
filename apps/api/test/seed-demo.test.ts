import { MongoClient } from 'mongodb';
import { afterAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { seedDemo } from '../src/db/seed-demo.js';

// A database of its own, so the demo content never leaks into other tests.
const uri = process.env.MONGODB_URI!;
const name = `${process.env.MONGODB_DB}_demo`;
const client = new MongoClient(uri);
afterAll(async () => {
  await client.db(name).dropDatabase();
  await client.close();
});

describe('demo seed', () => {
  it('builds the releases, roadmap, time, dependency and document content, and can run twice', async () => {
    await client.db(name).dropDatabase();
    await migrate(uri, name);
    await seed(uri, name);
    await seedDemo(uri, name);
    const db = client.db(name);
    const counts = async () => ({
      versions: await db.collection('versions').countDocuments(),
      components: await db.collection('components').countDocuments(),
      worklogs: await db.collection('worklogs').countDocuments(),
      folders: await db.collection('space_folders').countDocuments(),
      templates: await db.collection('checklist_templates').countDocuments(),
      sprints: await db.collection('sprints').countDocuments(),
      links: await db.collection('work_item_links').countDocuments({ linkType: 'blocks' }),
      channels: await db.collection('channels').countDocuments(),
      messages: await db.collection('messages').countDocuments(),
      reactions: await db.collection('message_reactions').countDocuments(),
      pins: await db.collection('pins').countDocuments(),
    });
    const first = await counts();
    expect(first).toMatchObject({ versions: 2, components: 2, worklogs: 3, folders: 4, templates: 1 });
    expect(first.links).toBeGreaterThanOrEqual(1);
    expect(first.sprints).toBeGreaterThanOrEqual(3);

    // The Engineering epic is on the roadmap and a story carries a checklist.
    expect(await db.collection('work_items').countDocuments({ type: 'epic', startDate: { $ne: null } })).toBeGreaterThanOrEqual(1);
    expect(await db.collection('work_items').countDocuments({ 'checklist.0': { $exists: true } })).toBe(1);

    // Chat: channels people really have, threads, reactions, pins, and a space channel with its bot.
    expect(first.channels).toBeGreaterThanOrEqual(8);
    expect(first.messages).toBeGreaterThanOrEqual(20);
    expect(first.reactions).toBeGreaterThanOrEqual(8);
    expect(first.pins).toBeGreaterThanOrEqual(2);
    expect(await db.collection('messages').countDocuments({ replyCount: { $gt: 0 } })).toBeGreaterThanOrEqual(2);
    expect(await db.collection('messages').countDocuments({ kind: 'bot' })).toBeGreaterThanOrEqual(1);
    expect(await db.collection('channels').countDocuments({ type: 'dm' })).toBe(2);
    expect(await db.collection('channels').countDocuments({ spaceId: { $type: 'string' } })).toBeGreaterThanOrEqual(3);
    expect(await db.collection('user_statuses').countDocuments({ text: { $ne: null } })).toBe(1);

    await seedDemo(uri, name);
    expect(await counts()).toEqual(first);
  }, 120_000);
});
