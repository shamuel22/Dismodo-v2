import { z } from 'zod';
import { ModelError, postJson, type DecisionModel, type StructuredRequest } from './types';

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

const MessagesResponse = z.object({
  content: z.array(z.object({ type: z.string(), name: z.string().nullish(), input: z.unknown() })).nullish(),
  stop_reason: z.string().nullish(),
  usage: z.object({ input_tokens: z.number().nullish(), output_tokens: z.number().nullish() }).nullish(),
  error: z.object({ message: z.string().nullish() }).nullish(),
});

/**
 * Anthropic Messages API. Structured output is obtained by forcing a single tool whose input schema is the
 * decision schema. Contract-tested with recorded responses; not exercised against the live API in CI.
 */
export function anthropicModel(options: AnthropicOptions): DecisionModel {
  const url = `${(options.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`;
  return {
    provider: 'anthropic',
    model: options.model,
    async complete(request: StructuredRequest) {
      const res = await postJson(
        url,
        {
          headers: {
            'x-api-key': options.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: options.model,
            max_tokens: request.maxTokens,
            system: request.system,
            messages: [{ role: 'user', content: request.user }],
            tools: [
              { name: request.schemaName, description: 'Return the decision.', input_schema: request.schema },
            ],
            tool_choice: { type: 'tool', name: request.schemaName },
          }),
        },
        request.timeoutMs,
      );
      const parsed = MessagesResponse.safeParse(res.body);
      if (!parsed.success)
        throw new ModelError('http_error', `HTTP ${res.status}: unexpected response shape`, res.latency_ms);
      const body = parsed.data;
      const usage = {
        input_tokens: body.usage?.input_tokens ?? null,
        output_tokens: body.usage?.output_tokens ?? null,
        reasoning_tokens: null,
      };
      if (!res.ok) {
        throw new ModelError(
          'http_error',
          `HTTP ${res.status}: ${body.error?.message ?? 'request failed'}`.slice(0, 200),
          res.latency_ms,
          usage,
        );
      }
      if (body.stop_reason === 'max_tokens')
        throw new ModelError('truncated', 'output hit max_tokens', res.latency_ms, usage);
      if (body.stop_reason === 'refusal')
        throw new ModelError('refused', 'the model declined', res.latency_ms, usage);
      const tool = body.content?.find(
        (block) => block.type === 'tool_use' && block.name === request.schemaName,
      );
      if (!tool) throw new ModelError('truncated', 'no tool output', res.latency_ms, usage);
      return { content: JSON.stringify(tool.input), latency_ms: res.latency_ms, ...usage };
    },
  };
}
