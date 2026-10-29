import { createDatabase } from './db/client';
import { loadEnv } from './env';
import { buildServer } from './server';

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
const app = buildServer({ db: database.db, logLevel: env.LOG_LEVEL });

const shutdown = async () => {
  await app.close();
  await database.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: env.PORT, host: env.HOST });
