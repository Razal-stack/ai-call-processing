// Logs request start + finish (method, path, status, latency). Never logs the
// body — transcripts are PII; handlers log a redacted descriptor instead.

import type { NextFunction, Request, Response } from "express";

/** Middleware that logs one line on request start and one on response finish. */
export function requestLogging() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();
    req.log.info("request received", { method: req.method, path: req.path });

    res.on("finish", () => {
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      req.log.info("request completed", {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        latency_ms: Math.round(elapsedMs),
      });
    });

    next();
  };
}
