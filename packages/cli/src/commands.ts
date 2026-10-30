import { readFile, writeFile } from 'node:fs/promises';
import { builtinRegistry } from '@dismodo/activities';
import type { ValidationIssue } from '@dismodo/contracts';
import { validatePackage } from '@dismodo/engine';

export interface Output {
  json: boolean;
  log: (line: string) => void;
}

export interface CommandResult {
  exitCode: number;
  data: unknown;
}

export async function readPackageFile(path: string): Promise<unknown> {
  const text = await readFile(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`, { cause: error });
  }
}

function printIssues(out: Output, issues: ValidationIssue[]) {
  for (const issue of issues) {
    out.log(`  ✗ ${issue.path || '(root)'}  [${issue.code}] ${issue.message}`);
    if (issue.hint) out.log(`      hint: ${issue.hint}`);
  }
}

/** Validates a package offline with the same engine and components the API uses. */
export async function validateCommand(file: string, out: Output): Promise<CommandResult> {
  const result = validatePackage(await readPackageFile(file), builtinRegistry);
  if (!out.json) {
    if (result.ok) {
      const s = result.summary;
      out.log(`✓ ${file} is a valid package.`);
      out.log(
        `  tests ${s.tests_passed}/${s.tests_total} · reserved checks ${s.reserved_checks} · practice pool ${s.practice_pool}/${s.candidate_pool}`,
      );
      out.log(`  components ${s.components.activity}, ${s.components.evaluator}`);
    } else {
      out.log(`✗ ${file} has ${result.issues.length} problem(s):`);
      printIssues(out, result.issues);
    }
  }
  return { exitCode: result.ok ? 0 : 1, data: result };
}

export interface ApiOptions {
  apiUrl: string;
  apiKey: string | undefined;
}

async function api(options: ApiOptions, method: string, path: string, body?: unknown) {
  if (!options.apiKey) throw new Error('Set DISMODO_API_KEY or pass --key.');
  const res = await fetch(new URL(path, options.apiUrl), {
    method,
    headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, payload };
}

function apiError(out: Output, status: number, payload: Record<string, unknown>): CommandResult {
  const error = payload.error as {
    code?: string;
    message?: string;
    details?: { issues?: ValidationIssue[] };
  };
  if (!out.json) {
    out.log(`✗ ${status} ${error?.code ?? 'error'}: ${error?.message ?? 'request failed'}`);
    if (error?.details?.issues) printIssues(out, error.details.issues);
  }
  return { exitCode: 1, data: payload };
}

export async function importCommand(file: string, options: ApiOptions, out: Output): Promise<CommandResult> {
  const { status, payload } = await api(options, 'POST', '/v1/packages', await readPackageFile(file));
  if (status !== 200 && status !== 201) return apiError(out, status, payload);
  const pkg = payload.package as { ref: string; status: string; content_hash: string };
  if (!out.json) {
    out.log(
      `${status === 201 ? '✓ Imported' : '✓ Already imported (identical content)'} ${pkg.ref} as ${pkg.status}.`,
    );
    out.log(`  content hash ${pkg.content_hash}`);
    out.log(`  next: review it, then run  dismodo publish ${pkg.ref} --reviewer "<your name>"`);
  }
  return { exitCode: 0, data: payload };
}

export async function publishCommand(
  ref: string,
  reviewer: string,
  contentHash: string | undefined,
  options: ApiOptions,
  out: Output,
): Promise<CommandResult> {
  const at = ref.lastIndexOf('@');
  if (at <= 0) throw new Error('Use experience-id@version, e.g. parts-of-a-whole@1.0.0.');
  const statement = await api(options, 'GET', '/v1/packages/attestation');
  const { status, payload } = await api(
    options,
    'POST',
    `/v1/packages/${ref.slice(0, at)}/${ref.slice(at + 1)}/publish`,
    {
      attestation: { reviewer, statement: (statement.payload as { statement: string }).statement },
      ...(contentHash ? { content_hash: contentHash } : {}),
    },
  );
  if (status !== 200) return apiError(out, status, payload);
  if (!out.json) out.log(`✓ Published ${ref}, reviewed by ${reviewer}.`);
  return { exitCode: 0, data: payload };
}

/** Asks DISMODO to draft a package from notes; writes it to a file for review. Never imports or publishes. */
export async function draftCommand(
  notesFile: string,
  experienceId: string,
  outFile: string,
  options: ApiOptions,
  out: Output,
): Promise<CommandResult> {
  const source = await readFile(notesFile, 'utf8');
  const { status, payload } = await api(options, 'POST', '/v1/package-drafts', {
    source,
    experience_id: experienceId,
  });
  if (status !== 200) return apiError(out, status, payload);
  const result = payload as {
    draft: unknown;
    valid: boolean;
    issues: ValidationIssue[];
    rounds: number;
    attempts: Array<{ model: string; status: string; latency_ms: number }>;
  };
  if (result.draft) await writeFile(outFile, JSON.stringify(result.draft, null, 2) + '\n');
  if (!out.json) {
    const models = result.attempts
      .map((a) => `${a.model} ${a.status} ${(a.latency_ms / 1000).toFixed(1)} s`)
      .join(', ');
    out.log(
      `${result.valid ? '✓' : '✗'} Draft ${result.valid ? 'passes validation' : 'still has problems'} after ${result.rounds} round(s) (${models}).`,
    );
    if (!result.valid) printIssues(out, result.issues);
    if (result.draft)
      out.log(
        `  written to ${outFile} — review every fact and text, then: dismodo validate / import / publish`,
      );
  }
  return { exitCode: result.valid ? 0 : 1, data: payload };
}
