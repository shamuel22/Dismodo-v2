import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client';

const migrationsFolder = new URL('../../drizzle', import.meta.url).pathname;

/** Arbitrary key for the advisory lock that serialises migrations across processes. */
const MIGRATION_LOCK = 4_100_001;

/**
 * Applies pending migrations. Several processes may start at once (test files in parallel, the API next to a
 * seed script), so a session-level advisory lock lets one migrate while the others wait, then find nothing to do.
 */
export async function runMigrations(db: Database): Promise<void> {
  const lock = await db.$client.connect();
  try {
    await lock.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await migrate(db, { migrationsFolder });
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    lock.release();
  }
}
