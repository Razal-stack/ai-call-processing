/*
 * Central error handler — consistent envelope, request id on every error, no
 * stack/internal detail leaked. Mapping:
 *   AppError                  → its statusCode + public message
 *   express JSON parse error  → 400 bad_request
 *   express payload too large → 413 payload_too_large
 *   anything else             → 500 internal_error (detail logged, not sent)
 */

import type { NextFunction, Request, Response } from "express";
import { type AppError, isAppError } from "../../lib/errors.js";
import { type ErrorResponse, ErrorResponseSchema } from "../../schemas/response.js";

interface BodyParserError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
}

/** Map any thrown value to a status, public code/message, and internal detail. */
function classify(err: unknown): {
  status: number;
  code: string;
  message: string;
  internal: unknown;
} {
  if (isAppError(err)) {
    const e = err as AppError;
    return { status: e.statusCode, code: e.code, message: e.message, internal: e.internal };
  }

  // express.json() errors: malformed JSON (400) and entity.too.large (413).
  if (err instanceof Error) {
    const be = err as BodyParserError;
    const status = be.status ?? be.statusCode;
    if (be.type === "entity.too.large" || status === 413) {
      return {
        status: 413,
        code: "payload_too_large",
        message: "Request body is too large.",
        internal: err.message,
      };
    }
    if (status === 400 || err.name === "SyntaxError") {
      return {
        status: 400,
        code: "bad_request",
        message: "Request body is not valid JSON.",
        internal: err.message,
      };
    }
  }

  return {
    status: 500,
    code: "internal_error",
    message: "An unexpected error occurred.",
    internal: err,
  };
}

/** The Express error-handling middleware (logs, then sends the safe envelope). */
export function errorHandler() {
  // Express identifies error handlers by their 4-arg arity — `next` must stay.
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const { status, code, message, internal } = classify(err);

    const logFields = { status, code, error: String(internal ?? message) };
    if (status >= 500) {
      req.log.error("request failed", logFields);
    } else {
      req.log.warn("request rejected", logFields);
    }

    const body: ErrorResponse = ErrorResponseSchema.parse({
      error: { code, message },
      meta: { request_id: req.requestId },
    });
    res.status(status).json(body);
  };
}
