import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client';

const migrationsFolder = new URL('../../drizzle', import.meta.url).pathname;

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder });
}
