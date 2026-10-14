import { randomUUID } from 'node:crypto';
import { MongoClient, type Db } from 'mongodb';

/**
 * Direct MongoDB access for end-to-end test setup (never used to assert behaviour). Documents are written
 * with every field the API expects, since nothing fills in defaults here.
 */
const uri = () => process.env.MONGODB_URI ?? 'mongodb://localhost:27018/?directConnection=true';
const dbName = () => process.env.MONGODB_DB ?? 'crewdeck';

export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(uri());
  try {
    await client.connect();
    return await fn(client.db(dbName()));
  } finally {
    await client.close();
  }
}

export async function orgIdOf(db: Db, slug: string) {
  const org = await db.collection('organizations').findOne({ slug });
  if (!org) throw new Error(`workspace ${slug} is missing: run pnpm db:seed first`);
  return org.id as string;
}

/** Finds or creates an active user (no password) and makes them a member of the workspace. */
export async function addMember(db: Db, slug: string, email: string, name: string) {
  const orgId = await orgIdOf(db, slug);
  const existing = await db.collection('users').findOne({ email });
  let userId: string;
  if (existing) {
    userId = existing.id as string;
    await db.collection('users').updateOne({ email }, { $set: { name } });
  } else {
    userId = randomUUID();
    await db.collection('users').insertOne({
      id: userId,
      email,
      name,
      avatarUrl: null,
      jobTitle: null,
      timezone: 'UTC',
      status: 'active',
      passwordHash: null,
      lastLoginAt: null,
      createdAt: new Date(),
    });
  }
  if (!(await db.collection('memberships').findOne({ orgId, userId }))) {
    await db.collection('memberships').insertOne({
      id: randomUUID(),
      orgId,
      userId,
      orgRole: 'member',
      status: 'active',
      deactivatedAt: null,
      reportsTo: null,
      crmRole: 'member',
      createdAt: new Date(),
    });
  }
}
