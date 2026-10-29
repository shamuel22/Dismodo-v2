import { readFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { builtinRegistry } from '@dismodo/activities';
import { createDatabase } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { packages } from '../src/db/schema';
import { loadEnv } from '../src/env';
import { ATTESTATION_STATEMENT, importPackage, publishPackage } from '../src/services/packages';
import { ensureTenant } from '../src/services/tenants';

/** Reference packages published by DISMODO itself and visible to every tenant. */
const REFERENCE_PACKAGES = ['../../../experiences/parts-of-a-whole/experience.json'];

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
await runMigrations(database.db);
const tenant = await ensureTenant(database.db, 'dismodo', 'DISMODO');

for (const path of REFERENCE_PACKAGES) {
  const content = JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
  const { created, row } = await importPackage(database.db, builtinRegistry, tenant.id, content);
  await publishPackage(database.db, tenant.id, row.experienceId, row.version, {
    reviewer: 'DISMODO editorial (Shamuel Perez)',
    statement: ATTESTATION_STATEMENT,
  });
  await database.db
    .update(packages)
    .set({ visibility: 'public' })
    .where(and(eq(packages.id, row.id)));
  console.log(
    `${created ? 'Imported' : 'Already present'} and published: ${row.experienceId}@${row.version} (public)`,
  );
}
await database.close();
