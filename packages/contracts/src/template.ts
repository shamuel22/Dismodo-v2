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

export function renderTemplate(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (value === undefined) throw new Error(`Template variable "${name}" has no value.`);
    return String(value);
  });
}
