import { z } from 'zod';
import { ModelError, postJson, type DecisionModel, type StructuredRequest } from './types';

export interface OpenAICompatibleOptions {
  /** Label for traces, e.g. "meta" or "openai-compatible". */
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Sent as reasoning_effort when set (Meta Model API: none|minimal|low|medium|high|...). */
  reasoningEffort?: string;
}

const ChatCompletion = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullish(),
        message: z.object({ content: z.string().nullish(), refusal: z.string().nullish() }).nullish(),
      }),
    )
    .nullish(),
  usage: z
    .object({
      prompt_tokens: z.number().nullish(),
      completion_tokens: z.number().nullish(),
      completion_tokens_details: z.object({ reasoning_tokens: z.number().nullish() }).nullish(),
    })
    .nullish(),
  error: z.object({ message: z.string().nullish() }).nullish(),
});

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
      const res = await postJson(
        url,
        {
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
      const parsed = ChatCompletion.safeParse(res.body);
      if (!parsed.success)
        throw new ModelError('http_error', `HTTP ${res.status}: unexpected response shape`, res.latency_ms);
      const body = parsed.data;
      const usage = {
        input_tokens: body.usage?.prompt_tokens ?? null,
        output_tokens: body.usage?.completion_tokens ?? null,
        reasoning_tokens: body.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      };
      if (!res.ok) {
        throw new ModelError(
          'http_error',
          `HTTP ${res.status}: ${body.error?.message ?? 'request failed'}`.slice(0, 200),
          res.latency_ms,
          usage,
        );
      }
      const choice = body.choices?.[0];
      if (choice?.message?.refusal)
        throw new ModelError('refused', choice.message.refusal.slice(0, 200), res.latency_ms, usage);
      if (choice?.finish_reason === 'length' || !choice?.message?.content) {
        throw new ModelError(
          'truncated',
          `no complete output (finish_reason=${choice?.finish_reason})`,
          res.latency_ms,
          usage,
        );
      }
      return { content: choice.message.content, latency_ms: res.latency_ms, ...usage };
    },
  };
}
