import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env.js";
import { createProvider, ProviderConfigError } from "../../src/llm/factory.js";

function env(overrides: Record<string, string>) {
  return loadEnv(overrides as NodeJS.ProcessEnv);
}

describe("createProvider — selection + key enforcement", () => {
  it("defaults to gemini and requires its key", () => {
    expect(() => createProvider(env({}))).toThrow(ProviderConfigError);
    const p = createProvider(env({ GEMINI_API_KEY: "k" }));
    expect(p.name).toBe("gemini");
  });

  it("constructs openai when selected with a key", () => {
    const p = createProvider(env({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" }));
    expect(p.name).toBe("openai");
  });

  it("throws a clear error naming the missing key", () => {
    expect(() => createProvider(env({ LLM_PROVIDER: "anthropic" }))).toThrow(
      /ANTHROPIC_API_KEY is not set/,
    );
  });

  it("constructs the fake provider without any key", () => {
    expect(createProvider(env({ LLM_PROVIDER: "fake" })).name).toBe("fake");
  });
});

describe("env overrides win over per-provider defaults", () => {
  it("LLM_MODEL overrides the provider model (no throw on construction)", () => {
    // Different model must not change which provider is built.
    const p = createProvider(
      env({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "k", LLM_MODEL: "gpt-override" }),
    );
    expect(p.name).toBe("openai");
  });

  it("accepts an OPENAI_BASE_URL override", () => {
    const p = createProvider(
      env({
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "k",
        OPENAI_BASE_URL: "https://proxy.internal/v1/chat/completions",
      }),
    );
    expect(p.name).toBe("openai");
  });
});

describe("loadEnv guards", () => {
  it("rejects fake provider in production", () => {
    expect(() => env({ NODE_ENV: "production", LLM_PROVIDER: "fake" })).toThrow(
      /cannot be used in production/,
    );
  });

  it("rejects an invalid base-URL", () => {
    expect(() => env({ OPENAI_BASE_URL: "not-a-url" })).toThrow();
  });

  it("allows a real provider in production", () => {
    const e = env({ NODE_ENV: "production", LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" });
    expect(e.NODE_ENV).toBe("production");
  });
});
