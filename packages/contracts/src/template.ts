/**
 * Minimal text templates: `{{ variable }}` placeholders from a closed set, no logic, no HTML.
 * Builders write them; the engine fills them with values computed from the current item.
 */
const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]{0,40})\s*\}\}/g;
const ANY_BRACES = /\{\{|\}\}/;

export function templateVariables(template: string): string[] {
  return [...new Set(Array.from(template.matchAll(PLACEHOLDER), (m) => m[1]!))];
}

/** Returns the malformed fragments left after removing every well-formed placeholder. */
export function malformedPlaceholders(template: string): boolean {
  return ANY_BRACES.test(template.replace(PLACEHOLDER, ''));
}

/**
 * Fills placeholders. A value that starts a sentence is capitalised ("one quarter" → "One quarter"), so
 * builders can place variables anywhere without producing lowercase sentence starts.
 */
export function renderTemplate(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(PLACEHOLDER, (_match, name: string, offset: number) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (value === undefined) throw new Error(`Template variable "${name}" has no value.`);
    const text = String(value);
    const startsSentence = /^\s*$|[.!?:]\s+$/.test(template.slice(0, offset));
    return startsSentence ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  });
}
