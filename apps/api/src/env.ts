import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_BASE_URL: z.url().default('http://localhost:4100'),
  /** Learner session page; defaults to the page the API serves at /s/. */
  SESSION_PAGE_URL: z.url().optional(),
  META_API_KEY: z.string().default(''),
  META_BASE_URL: z.url().default('https://api.meta.ai/v1'),
  META_MODEL: z.string().default('muse-spark-1.3'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});
export type Env = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
