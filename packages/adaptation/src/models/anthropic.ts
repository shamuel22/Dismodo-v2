import { fetchWithTimeout, ModelError, type DecisionModel, type StructuredRequest } from './types';

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

interface MessagesResponse {
  content?: Array<{ type: string; name?: string; input?: unknown }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

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
      const started = Date.now();
      const elapsed = () => Date.now() - started;
      let res: Response;
      try {
        res = await fetchWithTimeout(
          url,
          {
            method: 'POST',
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
                {
                  name: request.schemaName,
                  description: 'Return the decision.',
                  input_schema: request.schema,
                },
              ],
              tool_choice: { type: 'tool', name: request.schemaName },
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
      const body = (await res.json().catch(() => ({}))) as MessagesResponse;
      const usage = {
        input_tokens: body.usage?.input_tokens ?? null,
        output_tokens: body.usage?.output_tokens ?? null,
        reasoning_tokens: null,
      };
      if (!res.ok) {
        throw new ModelError(
          'http_error',
          `HTTP ${res.status}: ${body.error?.message ?? 'request failed'}`.slice(0, 200),
          elapsed(),
          usage,
        );
      }
      if (body.stop_reason === 'max_tokens')
        throw new ModelError('truncated', 'output hit max_tokens', elapsed(), usage);
      if (body.stop_reason === 'refusal')
        throw new ModelError('refused', 'the model declined', elapsed(), usage);
      const tool = body.content?.find(
        (block) => block.type === 'tool_use' && block.name === request.schemaName,
      );
      if (!tool) throw new ModelError('truncated', 'no tool output', elapsed(), usage);
      return { content: JSON.stringify(tool.input), latency_ms: elapsed(), ...usage };
    },
  };
}
