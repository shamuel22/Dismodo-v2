import { describe, expect, it } from 'vitest';
import { malformedPlaceholders, renderTemplate, templateVariables } from './template';

describe('templates', () => {
  it('lists distinct variables', () => {
    expect(templateVariables('{{total}} {{ item_plural }}, {{total}}')).toEqual(['total', 'item_plural']);
  });

  it('renders known values and refuses missing ones', () => {
    expect(
      renderTemplate('A project has {{total}} {{item_plural}}.', { total: 20, item_plural: 'tasks' }),
    ).toBe('A project has 20 tasks.');
    expect(() => renderTemplate('{{missing}}', {})).toThrow(/missing/);
    expect(() => renderTemplate('{{constructor}}', {})).toThrow(/constructor/);
  });

  it('capitalises values that start a sentence, and only those', () => {
    const values = { fraction_text: 'one quarter', total: 20 };
    expect(renderTemplate('{{fraction_text}} of {{total}}.', values)).toBe('One quarter of 20.');
    expect(renderTemplate('Compare. {{fraction_text}} of {{total}}.', values)).toBe(
      'Compare. One quarter of 20.',
    );
    expect(renderTemplate('Take {{fraction_text}}.', values)).toBe('Take one quarter.');
  });

  it('detects malformed placeholders', () => {
    expect(malformedPlaceholders('ok {{total}}')).toBe(false);
    expect(malformedPlaceholders('broken {{total}')).toBe(true);
    expect(malformedPlaceholders('{{Total}}')).toBe(true);
  });

  it('does not re-interpret values as templates', () => {
    expect(renderTemplate('{{a}}', { a: '{{b}}' })).toBe('{{b}}');
  });
});
