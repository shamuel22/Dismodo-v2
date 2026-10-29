import { ModelError, type DecisionModel } from './types';

export type Fault = 'timeout' | 'error' | 'invalid' | 'refuse';

/** Wraps a model so it fails in a chosen way: used to demonstrate and test the fallback path. */
export function withFault(model: DecisionModel, fault: Fault): DecisionModel {
  return {
    provider: model.provider,
    model: model.model,
    async complete() {
      switch (fault) {
        case 'timeout':
          throw new ModelError('timeout', 'injected fault: deadline exceeded', 0);
        case 'error':
          throw new ModelError('http_error', 'injected fault: HTTP 503', 0);
        case 'refuse':
          throw new ModelError('refused', 'injected fault: refused', 0);
        case 'invalid':
          return {
            content: '{"not":"a decision"}',
            latency_ms: 0,
            input_tokens: null,
            output_tokens: null,
            reasoning_tokens: null,
          };
      }
    },
  };
}
