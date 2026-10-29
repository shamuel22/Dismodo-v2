/** Error thrown for every non-2xx API response, preserving the API's `{ error: ... }` shape. */
export class DismodoApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'DismodoApiError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
