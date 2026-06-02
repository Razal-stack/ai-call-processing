// Controlled errors carry an HTTP status, a public message (safe to return),
// and an optional internal detail (logged, never sent). Non-AppErrors → 500.

export type ErrorCode =
  | "bad_request"
  | "payload_too_large"
  | "llm_unavailable"
  | "llm_timeout"
  | "internal_error";

export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: ErrorCode;

  /** Extra context for logs only — never serialised into the response body. */
  readonly internal?: unknown;

  constructor(message: string, internal?: unknown) {
    super(message);
    this.name = new.target.name;
    if (internal !== undefined) {
      this.internal = internal;
    }
    // Restore the prototype chain when extending a built-in.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Request violated the contract (failed input validation). */
export class BadRequestError extends AppError {
  readonly statusCode = 400;
  readonly code = "bad_request";
}

/** Transcript (or body) exceeded the configured size cap. */
export class PayloadTooLargeError extends AppError {
  readonly statusCode = 413;
  readonly code = "payload_too_large";
}

/** Upstream LLM provider failed/refused, or gave unusable output after a retry. */
export class LLMUnavailableError extends AppError {
  readonly statusCode = 502;
  readonly code = "llm_unavailable";
}

/** Upstream LLM provider did not respond within the timeout budget. */
export class LLMTimeoutError extends AppError {
  readonly statusCode = 504;
  readonly code = "llm_timeout";
}

/** Type guard distinguishing controlled errors from unexpected ones. */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
