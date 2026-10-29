import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { apiKeys, tenants } from '../db/schema';
import { generateApiKey, SCOPES, type Scope } from '../auth/keys';

export async function ensureTenant(db: Database, slug: string, name: string) {
  await db.insert(tenants).values({ slug, name }).onConflictDoNothing({ target: tenants.slug });
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug));
  return tenant!;
}

/** Creates an API key and returns the plaintext once; only its hash is stored. */
export async function createApiKey(
  db: Database,
  tenantId: string,
  label: string,
  scopes: readonly Scope[] = SCOPES,
): Promise<{ id: string; key: string; prefix: string; scopes: Scope[] }> {
  const { key, prefix, secretHash } = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({ tenantId, prefix, secretHash, label, scopes: [...scopes] })
    .returning({ id: apiKeys.id });
  return { id: row!.id, key, prefix, scopes: [...scopes] };
}
