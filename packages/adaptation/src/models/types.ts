import type { ModelAttempt } from '@dismodo/contracts';

/** A request for one JSON object that must match a strict JSON Schema. */
export interface StructuredRequest {
  system: string;
  /** User content; the caller serialises untrusted data as JSON inside it. */
  user: string;
  schemaName: string;
  /** Strict JSON Schema for the output; when omitted, any JSON object is requested (validated by the caller). */
  schema?: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
}

export interface StructuredResult {
  /** Raw JSON text returned by the model; validated by the caller. */
  content: string;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
}

/**
 * Any model that can return schema-constrained JSON. DISMODO decides with whichever provider is configured;
 * the controller and validator treat every provider the same way.
 */
export interface DecisionModel {
  readonly provider: string;
  readonly model: string;
  complete(request: StructuredRequest): Promise<StructuredResult>;
}

export class ModelError extends Error {
  constructor(
    readonly status: Exclude<ModelAttempt['status'], 'ok' | 'invalid_output' | 'rejected'>,
    message: string,
    readonly latency_ms: number,
    readonly usage: Pick<StructuredResult, 'input_tokens' | 'output_tokens' | 'reasoning_tokens'> = {
      input_tokens: null,
      output_tokens: null,
      reasoning_tokens: null,
    },
  ) {
    super(message);
  }
}

/**
 * POST JSON with one hard deadline covering the whole exchange, body included: a provider that sends headers
 * and then stalls still times out. Body decoding failures are reported, not swallowed.
 */
export async function postJson(
  url: string,
  init: { headers: Record<string, string>; body: string },
  timeoutMs: number,
): Promise<{ status: number; ok: boolean; body: unknown; latency_ms: number }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', ...init, signal: controller.signal });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new ModelError('http_error', `HTTP ${res.status}: response is not JSON`, Date.now() - started);
    }
    return { status: res.status, ok: res.ok, body, latency_ms: Date.now() - started };
  } catch (error) {
    if (error instanceof ModelError) throw error;
    const aborted = (error as Error).name === 'AbortError' || controller.signal.aborted;
    throw new ModelError(
      aborted ? 'timeout' : 'http_error',
      aborted ? 'deadline exceeded' : (error as Error).message.slice(0, 200),
      Date.now() - started,
    );
  } finally {
    clearTimeout(timer);
  }
}
