// Request-id middleware: honour an inbound x-request-id or mint a UUID, attach
// it to the request + response header, and bind a request-scoped child logger.

import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Logger } from "../../lib/logger.js";

// `req.requestId` / `req.log` are declared in src/types/express.d.ts.

const HEADER = "x-request-id";
// Accept only sane inbound ids; otherwise generate our own.
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Middleware that assigns/propagates the request id and binds the child logger. */
export function requestId(baseLogger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const inbound = req.header(HEADER);
    const id = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
    req.requestId = id;
    req.log = baseLogger.child({ request_id: id });
    res.setHeader(HEADER, id);
    next();
  };
}
