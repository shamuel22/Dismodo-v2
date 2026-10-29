import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests hit a real Postgres; load DATABASE_URL from the repo .env when present.
    env: loadRootEnv(),
  },
});

function loadRootEnv(): Record<string, string> {
  try {
    process.loadEnvFile(new URL('../../.env', import.meta.url));
  } catch {
    // CI provides variables directly.
  }
  return { DATABASE_URL: process.env.DATABASE_URL ?? '' };
}
