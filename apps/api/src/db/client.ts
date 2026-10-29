import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export type Database = ReturnType<typeof createDatabase>['db'];

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool);
  return { db, pool, close: () => pool.end() };
}
