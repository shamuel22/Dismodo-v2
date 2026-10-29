import { parseArgs } from 'node:util';
import { SCOPES, type Scope } from '../src/auth/keys';
import { createDatabase } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { loadEnv } from '../src/env';
import { createApiKey, ensureTenant } from '../src/services/tenants';

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    name: { type: 'string' },
    label: { type: 'string', default: 'default' },
    scopes: { type: 'string', default: SCOPES.join(',') },
  },
});
if (!values.slug || !values.name) {
  console.error('Usage: create-tenant --slug acme --name "Acme Training" [--label ci] [--scopes a,b]');
  process.exit(1);
}
const scopes = values.scopes.split(',').map((s) => s.trim()) as Scope[];
const unknown = scopes.filter((s) => !SCOPES.includes(s));
if (unknown.length) {
  console.error(`Unknown scopes: ${unknown.join(', ')}. Valid: ${SCOPES.join(', ')}`);
  process.exit(1);
}

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
await runMigrations(database.db);
const tenant = await ensureTenant(database.db, values.slug, values.name);
const key = await createApiKey(database.db, tenant.id, values.label, scopes);
await database.close();

console.log(`Tenant: ${tenant.slug} (${tenant.id})`);
console.log(`Scopes: ${key.scopes.join(', ')}`);
console.log(`API key (shown once, store it now):\n${key.key}`);
