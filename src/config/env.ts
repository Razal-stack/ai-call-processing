// Environment validated once at boot (fail-fast). Provider keys are all optional
// here; the factory enforces that the *selected* provider's key is present, so
// the server can still boot and serve /health with no key configured.

import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  /** Which LLM provider to use. Gemini is the default (free tier). */
  LLM_PROVIDER: z.enum(["gemini", "openai", "anthropic", "fake"]).default("gemini"),

  /** Cross-provider model override. If set, wins over the per-provider default. */
  LLM_MODEL: z.string().min(1).optional(),

  /** Per-provider model defaults (used unless LLM_MODEL overrides). Each is the
   * cheap-fast tier of its family — the right fit for small structured extraction
   * (a frontier model is slower + pricier with no accuracy gain here). Unversioned
   * aliases track the current GA snapshot; pin a dated id if you need repeatability. */
  GEMINI_MODEL: z.string().min(1).default("gemini-2.5-flash-lite"),
  OPENAI_MODEL: z.string().min(1).default("gpt-5.4-mini"),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-haiku-4-5"),

  /** Sampling temperature for extraction. Low → deterministic. */
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0),

  /** Hard cap on model output tokens (extraction JSON is small). */
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1024),

  /** Per-call timeout budget for the provider, in ms. A safety net, not a target:
   * real calls return in ~1s (Flash-Lite). Defaulted to 3s for real-time/voice —
   * a conversation can't wait longer. Raise it (e.g. 8000) for local testing on a
   * slow link or for batch use. A timeout fails fast (no retry) — see
   * extraction.service. */
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),

  /** Provider API keys — all optional (only the selected one is required). */
  GEMINI_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  /** Provider endpoints. Defaults to the public API; override for a proxy /
   * Azure / gateway, or to point tests at a mock server. */
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1/chat/completions"),
  ANTHROPIC_BASE_URL: z.string().url().default("https://api.anthropic.com/v1/messages"),
  ANTHROPIC_API_VERSION: z.string().min(1).default("2023-06-01"),

  /** Above this → 413 (bounds cost/latency). 20k chars ≈ a very long call. */
  MAX_TRANSCRIPT_CHARS: z.coerce.number().int().positive().default(20_000),

  /** Below this many chars we skip the LLM and return `insufficient`. */
  MIN_MEANINGFUL_TRANSCRIPT_CHARS: z.coerce.number().int().positive().default(15),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parse + validate the environment once at startup; throws listing every issue. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = result.data;

  // Guard: the fake provider must never serve production traffic.
  if (env.NODE_ENV === "production" && env.LLM_PROVIDER === "fake") {
    throw new Error('Invalid configuration: LLM_PROVIDER="fake" cannot be used in production.');
  }

  return Object.freeze(env);
}
