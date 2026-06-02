// Selects + constructs the configured provider (Gemini default). Model and
// endpoint come from env (per-provider defaults, with LLM_MODEL as a cross-
// provider override). The selected provider's key must be present, else a clear
// config error. `fake` needs no key.

import type { Env } from "../config/env.js";
import type { LLMProvider } from "./provider.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { FakeProvider } from "./providers/fake.js";
import { GeminiProvider } from "./providers/gemini.js";
import { OpenAIProvider } from "./providers/openai.js";

export class ProviderConfigError extends Error {}

/** Construct the provider named by env.LLM_PROVIDER. */
export function createProvider(env: Env): LLMProvider {
  switch (env.LLM_PROVIDER) {
    case "gemini": {
      const key = requireKey(env.GEMINI_API_KEY, "GEMINI_API_KEY", "gemini");
      return new GeminiProvider(key, env.LLM_MODEL ?? env.GEMINI_MODEL);
    }
    case "openai": {
      const key = requireKey(env.OPENAI_API_KEY, "OPENAI_API_KEY", "openai");
      return new OpenAIProvider(key, env.LLM_MODEL ?? env.OPENAI_MODEL, env.OPENAI_BASE_URL);
    }
    case "anthropic": {
      const key = requireKey(env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY", "anthropic");
      return new AnthropicProvider(
        key,
        env.LLM_MODEL ?? env.ANTHROPIC_MODEL,
        env.ANTHROPIC_BASE_URL,
        env.ANTHROPIC_API_VERSION,
      );
    }
    case "fake":
      return new FakeProvider({ model: env.LLM_MODEL ?? "fake-model-1" });
    default: {
      // Exhaustiveness guard — unreachable while LLM_PROVIDER is a closed enum.
      const _never: never = env.LLM_PROVIDER;
      throw new ProviderConfigError(`Unsupported LLM_PROVIDER: ${String(_never)}`);
    }
  }
}

/** Return the key or throw a clear config error naming the missing env var. */
function requireKey(key: string | undefined, envVar: string, provider: string): string {
  if (!key) {
    throw new ProviderConfigError(
      `LLM_PROVIDER is "${provider}" but ${envVar} is not set. ` +
        `Set ${envVar}, choose a different LLM_PROVIDER, or use "fake" for tests.`,
    );
  }
  return key;
}
