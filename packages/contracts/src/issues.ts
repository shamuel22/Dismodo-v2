/**
 * A problem found while validating builder input. `path` is a JSON Pointer (RFC 6901) into the submitted
 * document so editors and CLIs can point at the exact field.
 */
export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
  hint?: string;
}

export function toJsonPointer(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return '';
  return '/' + path.map((segment) => String(segment).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}
