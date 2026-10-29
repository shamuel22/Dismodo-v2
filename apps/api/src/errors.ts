/**
 * Error with a stable machine-readable code. Every API error response uses the shape
 * `{ error: { code, message, details? } }`.
 */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
