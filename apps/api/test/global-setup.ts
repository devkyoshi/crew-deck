import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';

export default async function setup() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url || !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL and DATABASE_ADMIN_URL are required for tests');
  }
  await migrate(url, 'up');
  await seed(url);
}
