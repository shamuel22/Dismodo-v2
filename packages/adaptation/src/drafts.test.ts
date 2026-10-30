import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '@dismodo/activities';
import { draftPackage } from './drafts';
import type { DecisionModel } from './models/types';

const reference = JSON.parse(
  readFileSync(new URL('../../../experiences/parts-of-a-whole/experience.json', import.meta.url), 'utf8'),
);

function scripted(replies: string[]): DecisionModel & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    provider: 'test',
    model: 'drafter',
    prompts,
    async complete(req) {
      prompts.push(req.user);
      return {
        content: replies.shift() ?? '{}',
        latency_ms: 10,
        input_tokens: 1,
        output_tokens: 1,
        reasoning_tokens: null,
      };
    },
  };
}

describe('package drafts', () => {
  it('repairs a draft once using the validator’s issues, forcing id, version and schema', async () => {
    const broken = { ...reference, title: 'Quarters <b>', experience_id: 'whatever', version: '9.9.9' };
    const model = scripted([JSON.stringify(broken), JSON.stringify(reference)]);
    const result = await draftPackage(
      [{ model, timeoutMs: 1000, maxTokens: 100 }],
      builtinRegistry,
      reference,
      {
        source: 'Teach adults to find a quarter of a set of things at work.',
        experienceId: 'quarters-at-work',
        activityRef: 'set-selection.v1',
      },
    );
    expect(result).toMatchObject({ valid: true, rounds: 2, issues: [] });
    expect(result.draft).toMatchObject({ experience_id: 'quarters-at-work', version: '1.0.0' });
    expect(model.prompts[1]).toContain('"path":"/title"');
    expect(model.prompts[0]).toContain('<builder_material>');
  });

  it('reports remaining issues instead of pretending a draft is valid', async () => {
    const model = scripted(['not json at all']);
    const result = await draftPackage(
      [{ model, timeoutMs: 1000, maxTokens: 100 }],
      builtinRegistry,
      reference,
      {
        source: 'Teach adults to find a quarter of a set of things at work.',
        experienceId: 'quarters-at-work',
        activityRef: 'set-selection.v1',
      },
    );
    expect(result).toMatchObject({ valid: false, draft: null, issues: [{ code: 'no_draft' }] });
  });
});
