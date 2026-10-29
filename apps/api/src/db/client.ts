import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export type Database = ReturnType<typeof createDatabase>['db'];

export function createDatabase(connectionString: string) {
  // Decisions can wait on a model inside a session transaction, so keep headroom in the pool.
  const pool = new pg.Pool({ connectionString, max: 20 });
  const db = drizzle(pool);
  return { db, pool, close: () => pool.end() };
}
