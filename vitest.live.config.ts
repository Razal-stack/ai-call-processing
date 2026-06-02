import { config as loadDotenv } from "dotenv";
import { defineConfig } from "vitest/config";

// LIVE config: load .env (the REAL provider + key), NOT .env.test.
loadDotenv({ path: ".env" });

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/live/**/*.test.ts"],
    testTimeout: 30_000, // real API round-trips
    hookTimeout: 30_000,
  },
});
