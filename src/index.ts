// Entrypoint: load .env, validate env (fail-fast), build the app, listen, and
// wire graceful shutdown so in-flight requests drain on SIGTERM/SIGINT.

import "dotenv/config";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createLogger } from "./lib/logger.js";

/** Boot the server. */
function main(): void {
  const env = loadEnv();
  const logger = createLogger({ level: env.LOG_LEVEL });

  const app = buildApp({ env, logger });
  const server = app.listen(env.PORT, () => {
    logger.info("server listening", {
      port: env.PORT,
      provider: env.LLM_PROVIDER,
      node_env: env.NODE_ENV,
    });
  });

  const shutdown = (signal: string): void => {
    logger.info("shutting down", { signal });
    server.close(() => process.exit(0));
    // Force-exit if connections refuse to drain.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

try {
  main();
} catch (err) {
  // Boot failure (e.g. invalid env) — log plainly and exit non-zero.
  process.stderr.write(`Failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
