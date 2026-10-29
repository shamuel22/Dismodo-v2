import { createDatabase } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { loadEnv } from '../src/env';

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
await runMigrations(database.db);
await database.close();
console.log('Migrations applied.');
