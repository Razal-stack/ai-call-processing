/**
 * Ambient augmentation of Express's Request with our per-request context.
 *
 * Express 5's request type lives in the global `Express.Request` namespace
 * (declared by `@types/express-serve-static-core`); merging into it here makes
 * `req.requestId` and `req.log` available across all handlers without casts.
 */

import type { Logger } from "../lib/logger.js";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      log: Logger;
    }
  }
}
