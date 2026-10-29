import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * Serves the web app build (landing, docs, session page) from the API in production, so one origin hosts
 * everything. Client-side routes fall back to index.html; API paths never do.
 */
export function registerWebApp(app: FastifyInstance, distDir: string): boolean {
  if (!existsSync(path.join(distDir, 'index.html'))) return false;
  void app.register(fastifyStatic, { root: distDir, wildcard: false, index: ['index.html'] });
  return true;
}

export function isApiPath(url: string): boolean {
  return /^\/(v1|health)(\/|$|\?)/.test(url) || url.startsWith('/llms') || /^\/docs\/[^/]+\.md$/.test(url);
}
