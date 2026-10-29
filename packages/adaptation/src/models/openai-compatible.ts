import { fetchWithTimeout, ModelError, type DecisionModel, type StructuredRequest } from './types';

export interface OpenAICompatibleOptions {
  /** Label for traces, e.g. "meta" or "openai-compatible". */
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Sent as reasoning_effort when set (Meta Model API: none|minimal|low|medium|high|...). */
  reasoningEffort?: string;
}

interface ChatCompletion {
  choices?: Array<{ finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string };
}

/**
 * Chat Completions with strict JSON Schema output. Works with the Meta Model API (Muse Spark, Muse Wonder)
 * and other OpenAI-compatible endpoints.
 */
export function openAICompatibleModel(options: OpenAICompatibleOptions): DecisionModel {
  const url = `${options.baseUrl.replace(/\/$/, '')}/chat/completions`;
  return {
    provider: options.provider,
    model: options.model,
    async complete(request: StructuredRequest) {
      const started = Date.now();
      const elapsed = () => Date.now() - started;
      let res: Response;
      try {
        res = await fetchWithTimeout(
          url,
          {
            method: 'POST',
            headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              model: options.model,
              messages: [
                { role: 'system', content: request.system },
                { role: 'user', content: request.user },
              ],
              max_completion_tokens: request.maxTokens,
              ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
              response_format: {
                type: 'json_schema',
                json_schema: { name: request.schemaName, strict: true, schema: request.schema },
              },
            }),
          },
          request.timeoutMs,
        );
      } catch (error) {
        const aborted = (error as Error).name === 'AbortError';
        throw new ModelError(
          aborted ? 'timeout' : 'http_error',
          aborted ? 'deadline exceeded' : (error as Error).message,
          elapsed(),
        );
      }
      const body = (await res.json().catch(() => ({}))) as ChatCompletion;
      const usage = {
        input_tokens: body.usage?.prompt_tokens ?? null,
        output_tokens: body.usage?.completion_tokens ?? null,
        reasoning_tokens: body.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      };
      if (!res.ok) {
        throw new ModelError(
          'http_error',
          `HTTP ${res.status}: ${body.error?.message ?? 'request failed'}`.slice(0, 200),
          elapsed(),
          usage,
        );
      }
      const choice = body.choices?.[0];
      if (choice?.message?.refusal)
        throw new ModelError('refused', choice.message.refusal.slice(0, 200), elapsed(), usage);
      if (choice?.finish_reason === 'length' || !choice?.message?.content) {
        throw new ModelError(
          'truncated',
          `no complete output (finish_reason=${choice?.finish_reason})`,
          elapsed(),
          usage,
        );
      }
      return { content: choice.message.content, latency_ms: elapsed(), ...usage };
    },
  };
}
