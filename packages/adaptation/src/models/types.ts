import type { ModelAttempt } from '@dismodo/contracts';

/** A request for one JSON object that must match a strict JSON Schema. */
export interface StructuredRequest {
  system: string;
  /** User content; the caller serialises untrusted data as JSON inside it. */
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
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

/** Fetch with a hard deadline; aborts the request when it passes. */
export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
