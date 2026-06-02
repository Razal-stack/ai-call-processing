/*
 * Extraction orchestration (impure): transcript → validated, normalised Extraction.
 *   1. pre-LLM gate  — trivial transcripts skip the model (cost saving)
 *   2. call provider, 3. re-validate the JSON with Zod (never trust it)
 *   4. one bounded retry; 5. transport failures propagate (502/504), but a
 *      reachable-yet-unparseable model degrades to a safe empty extraction (200)
 *   6. normalise DOB/symptoms/duration/name
 * The decision engine is NOT called here — the route composes extraction → decision.
 */

import type { Env } from "../config/env.js";
import { isAppError, LLMTimeoutError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { buildSystemInstruction, PROMPT_VERSION } from "../llm/prompt.js";
import type { LLMProvider } from "../llm/provider.js";
import { type Extraction, ExtractionSchema, emptyExtraction } from "../schemas/extraction.js";
import {
  normaliseDateOfBirth,
  normaliseDuration,
  normaliseName,
  normaliseSymptoms,
} from "./normalise.js";

/** Identifies the provider/model that produced an extraction (for `meta.model`). */
export interface ModelInfo {
  provider: string;
  name: string;
}

export interface ExtractionOutcome {
  extraction: Extraction;
  model: ModelInfo;
  prompt_version: string;
  /** True when the LLM was skipped (trivial transcript). */
  skipped_llm: boolean;
}

export class ExtractionService {
  constructor(
    private readonly provider: LLMProvider,
    private readonly env: Env,
  ) {}

  /** Run the pipeline, returning the extraction plus model/version metadata. */
  async run(transcript: string, logger: Logger): Promise<ExtractionOutcome> {
    const trimmed = transcript.trim();

    // 1. PRE-LLM GATE — skip trivial input, save the call.
    if (trimmed.length < this.env.MIN_MEANINGFUL_TRANSCRIPT_CHARS) {
      logger.info("transcript below meaningful threshold; skipping LLM", {
        threshold: this.env.MIN_MEANINGFUL_TRANSCRIPT_CHARS,
      });
      return {
        extraction: emptyExtraction(),
        model: { provider: this.provider.name, name: "none" },
        prompt_version: PROMPT_VERSION,
        skipped_llm: true,
      };
    }

    const raw = await this.extractWithRetry(trimmed, logger);
    return {
      extraction: raw.extraction,
      model: { provider: this.provider.name, name: raw.model },
      prompt_version: PROMPT_VERSION,
      skipped_llm: false,
    };
  }

  /** Call the provider, validate, retry once, then safe-fallback. */
  private async extractWithRetry(
    transcript: string,
    logger: Logger,
  ): Promise<{ extraction: Extraction; model: string }> {
    const request = {
      transcript,
      systemInstruction: buildSystemInstruction(),
      temperature: this.env.LLM_TEMPERATURE,
      maxOutputTokens: this.env.LLM_MAX_OUTPUT_TOKENS,
      timeoutMs: this.env.LLM_TIMEOUT_MS,
    };

    const maxAttempts = 2; // initial + one retry
    let lastModel = "unknown";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.provider.extract(request);
        lastModel = result.model;
        const parsed = ExtractionSchema.safeParse(result.json);
        if (parsed.success) {
          return { extraction: this.normalise(parsed.data), model: result.model };
        }
        logger.warn("LLM output failed schema validation", {
          attempt,
          issues: parsed.error.issues.length,
        });
      } catch (err) {
        // A timeout means the provider is already slow — retrying just doubles the
        // wait (fatal for a real-time call), so fail fast: propagate now → 504.
        if (err instanceof LLMTimeoutError) {
          throw err;
        }
        // Other transport/typed errors propagate after the final attempt (→ 502).
        if (attempt >= maxAttempts) {
          if (isAppError(err)) {
            throw err;
          }
          logger.error("LLM extraction failed unexpectedly", {
            attempt,
            error: String(err),
          });
          throw err;
        }
        logger.warn("LLM extraction attempt failed; retrying", {
          attempt,
          error: String(err),
        });
      }
    }

    // Reachable model but unparseable output after retry → safe degrade to 200.
    logger.warn("LLM produced no valid extraction after retries; using safe fallback");
    return { extraction: emptyExtraction(), model: lastModel };
  }

  /** Deterministically tidy the validated extraction. */
  private normalise(extraction: Extraction): Extraction {
    return {
      ...extraction,
      patient: {
        name: normaliseName(extraction.patient.name),
        date_of_birth: normaliseDateOfBirth(extraction.patient.date_of_birth),
      },
      clinical: {
        ...extraction.clinical,
        symptoms: normaliseSymptoms(extraction.clinical.symptoms),
        duration: normaliseDuration(extraction.clinical.duration),
      },
    };
  }
}
