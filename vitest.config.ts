import { config as loadDotenv } from "dotenv";
import { defineConfig } from "vitest/config";

// Load .env.test so tests run with the fake provider and no real keys.
loadDotenv({ path: ".env.test" });

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The live suite hits a real provider — opt-in only, via `pnpm test:live`.
    exclude: ["test/live/**", "**/node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Coverage targets the deterministic core + config wiring. LLM adapters are
      // thin I/O wrappers exercised via the fake provider, not line-measured.
      include: ["src/services/**", "src/schemas/**", "src/domain/**", "src/llm/factory.ts"],
    },
  },
});
