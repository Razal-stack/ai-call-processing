// Verifies the retry/latency policy of ExtractionService:
//  - a TIMEOUT fails fast (no retry — retrying a slow provider doubles the wait)
//  - a malformed RESPONSE still gets exactly one retry (cheap to re-attempt)
//  - a trivially short transcript skips the provider entirely (cost/latency gate)

import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env.js";
import { LLMTimeoutError, LLMUnavailableError } from "../../src/lib/errors.js";
import { createLogger } from "../../src/lib/logger.js";
import type { LLMProvider, LLMRequest, LLMResult } from "../../src/llm/provider.js";
import { ExtractionService } from "../../src/services/extraction.service.js";

const logger = createLogger({ level: "error", sink: () => {} });
const env = loadEnv({
  LLM_PROVIDER: "fake",
  MIN_MEANINGFUL_TRANSCRIPT_CHARS: "15",
} as NodeJS.ProcessEnv);

/** A provider that counts calls and returns/throws a scripted result each time. */
class CountingProvider implements LLMProvider {
  readonly name = "counting";
  calls = 0;
  constructor(private readonly behaviour: (call: number) => Promise<LLMResult>) {}
  extract(_request: LLMRequest): Promise<LLMResult> {
    this.calls += 1;
    return this.behaviour(this.calls);
  }
}

const VALID = {
  patient: { name: "John Smith", date_of_birth: "1990-01-02" },
  clinical: { symptoms: ["cough"], duration: "5 days", urgency: "routine" },
  intent: "book_appointment",
  confidence: 0.9,
  notes: [],
};
const MEANINGFUL = "I have had a bad cough for five days and want to see a doctor.";

describe("ExtractionService — retry & latency policy", () => {
  it("does NOT retry on a timeout (fails fast → propagates the timeout)", async () => {
    const provider = new CountingProvider(() => Promise.reject(new LLMTimeoutError("too slow")));
    const service = new ExtractionService(provider, env);

    await expect(service.run(MEANINGFUL, logger)).rejects.toBeInstanceOf(LLMTimeoutError);
    expect(provider.calls).toBe(1); // the key assertion: one attempt, no doubled wait
  });

  it("retries once on a malformed (non-timeout) response, then succeeds", async () => {
    const provider = new CountingProvider((call) =>
      call === 1
        ? Promise.resolve({ json: { garbage: true }, model: "m" })
        : Promise.resolve({ json: VALID, model: "m" }),
    );
    const service = new ExtractionService(provider, env);

    const outcome = await service.run(MEANINGFUL, logger);
    expect(provider.calls).toBe(2);
    expect(outcome.extraction.patient.name).toBe("John Smith");
  });

  it("propagates a non-timeout provider error (502) after the single retry", async () => {
    const provider = new CountingProvider(() =>
      Promise.reject(new LLMUnavailableError("provider exploded")),
    );
    const service = new ExtractionService(provider, env);

    await expect(service.run(MEANINGFUL, logger)).rejects.toBeInstanceOf(LLMUnavailableError);
    expect(provider.calls).toBe(2);
  });

  it("skips the provider entirely for a trivially short transcript", async () => {
    const provider = new CountingProvider(() => Promise.reject(new Error("must not be called")));
    const service = new ExtractionService(provider, env);

    const outcome = await service.run("hi", logger);
    expect(provider.calls).toBe(0);
    expect(outcome.skipped_llm).toBe(true);
  });
});
