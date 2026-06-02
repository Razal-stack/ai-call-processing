// buildApp wires middleware, routes, and the error handler — but does NOT listen,
// so tests drive it via supertest. Dependencies are injected (no global state).

import cors from "cors";
import express, { type Express } from "express";
import { errorHandler } from "./api/middleware/error-handler.js";
import { requestLogging } from "./api/middleware/logging.js";
import { requestId } from "./api/middleware/request-id.js";
import { healthRouter } from "./api/routes/health.js";
import { processCallRouter } from "./api/routes/process-call.js";
import type { Env } from "./config/env.js";
import { createLogger, type Logger } from "./lib/logger.js";
import { createProvider } from "./llm/factory.js";
import type { LLMProvider } from "./llm/provider.js";
import { ExtractionService } from "./services/extraction.service.js";

export interface AppDeps {
  env: Env;
  /** Override the provider (tests inject FakeProvider); defaults from env. */
  provider?: LLMProvider;
  /** Override the logger (tests inject a silent/capturing one). */
  logger?: Logger;
}

/** Wire and return the Express app (no listen). */
export function buildApp(deps: AppDeps): Express {
  const { env } = deps;
  const logger = deps.logger ?? createLogger({ level: env.LOG_LEVEL });
  const provider = deps.provider ?? createProvider(env);
  const service = new ExtractionService(provider, env);

  const app = express();
  app.disable("x-powered-by");
  app.use(cors());
  // Body limit gives express a coarse guard; the route enforces the precise
  // per-transcript cap (and the right 413 message) on top of this.
  app.use(express.json({ limit: `${Math.ceil(env.MAX_TRANSCRIPT_CHARS / 1000) + 8}kb` }));

  app.use(requestId(logger));
  app.use(requestLogging());

  app.use(healthRouter());
  app.use(processCallRouter(service, env));

  app.use(errorHandler());

  return app;
}
