import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../db/client';
import { apiKeys, tenants } from '../db/schema';
import { ApiError } from '../errors';
import { keyMatches, parseKey, type Scope } from './keys';

export interface AuthContext {
  tenantId: string;
  tenantSlug: string;
  keyId: string;
  scopes: Scope[];
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/** Builds a preHandler that authenticates the bearer API key and requires a scope. */
export function authenticator(db: Database) {
  return (scope: Scope) => async (request: FastifyRequest, _reply: FastifyReply) => {
    const header = request.headers.authorization;
    const key = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    const parsed = key ? parseKey(key) : null;
    if (!key || !parsed) {
      throw new ApiError(401, 'unauthorized', 'Send an API key as "Authorization: Bearer dsm_...".');
    }
    const [row] = await db
      .select({
        id: apiKeys.id,
        secretHash: apiKeys.secretHash,
        scopes: apiKeys.scopes,
        tenantId: tenants.id,
        tenantSlug: tenants.slug,
      })
      .from(apiKeys)
      .innerJoin(tenants, eq(tenants.id, apiKeys.tenantId))
      .where(and(eq(apiKeys.prefix, parsed.prefix), isNull(apiKeys.revokedAt)))
      .limit(1);
    if (!row || !keyMatches(key, row.secretHash)) {
      throw new ApiError(401, 'unauthorized', 'The API key is not valid or was revoked.');
    }
    if (!row.scopes.includes(scope)) {
      throw new ApiError(403, 'forbidden', `This API key lacks the "${scope}" scope.`);
    }
    request.auth = {
      tenantId: row.tenantId,
      tenantSlug: row.tenantSlug,
      keyId: row.id,
      scopes: row.scopes as Scope[],
    };
    // Best-effort usage stamp; never blocks the request.
    void db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.id))
      .catch(() => undefined);
  };
}

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw new ApiError(401, 'unauthorized', 'Authentication required.');
  return request.auth;
}
