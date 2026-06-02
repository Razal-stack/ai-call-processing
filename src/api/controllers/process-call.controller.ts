/*
 * POST /process-call controller — the HTTP concern: validate the request, call
 * the services, assemble + validate the response, set status. No business logic
 * lives here (that's services/ + domain/). Status policy:
 *   400 — body fails the schema (missing/blank/non-string transcript)
 *   413 — transcript exceeds the configured cap
 *   200 — processed (ALWAYS for valid input, incl. vague content; gaps in meta)
 *   502/504 — provider failure/timeout (thrown by adapters, mapped downstream)
 */

import type { RequestHandler } from "express";
import type { Env } from "../../config/env.js";
import { BadRequestError, PayloadTooLargeError } from "../../lib/errors.js";
import { redactTranscript } from "../../lib/logger.js";
import { ProcessCallRequestSchema } from "../../schemas/request.js";
import { type ProcessCallResponse, ProcessCallResponseSchema } from "../../schemas/response.js";
import { decide } from "../../services/decision.engine.js";
import type { ExtractionService } from "../../services/extraction.service.js";

/** Build the POST /process-call handler, closing over its dependencies. */
export function processCallController(service: ExtractionService, env: Env): RequestHandler {
  return async (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    try {
      // 1. Validate the request contract → 400 on failure.
      const parsed = ProcessCallRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        const msg = parsed.error.issues[0]?.message ?? "Invalid request body.";
        throw new BadRequestError(msg, parsed.error.issues);
      }
      const { transcript } = parsed.data;

      // 2. Enforce the size cap → 413.
      if (transcript.length > env.MAX_TRANSCRIPT_CHARS) {
        throw new PayloadTooLargeError(
          `transcript exceeds the maximum of ${env.MAX_TRANSCRIPT_CHARS} characters.`,
          { length: transcript.length },
        );
      }

      req.log.info("processing call", redactTranscript(transcript));

      // 3. Extract (LLM or skip) then decide (pure).
      const outcome = await service.run(transcript, req.log);
      const decision = decide(outcome.extraction);

      // 4. Assemble + validate the response → guaranteed-valid 200.
      const processingMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

      const payload: ProcessCallResponse = ProcessCallResponseSchema.parse({
        data: {
          patient: outcome.extraction.patient,
          clinical: {
            symptoms: outcome.extraction.clinical.symptoms,
            duration: outcome.extraction.clinical.duration,
            urgency: outcome.extraction.clinical.urgency,
          },
          intent: outcome.extraction.intent,
          confidence: decision.confidence,
          recommended_action: decision.recommended_action,
        },
        meta: {
          request_id: req.requestId,
          data_quality: decision.data_quality,
          warnings: decision.warnings,
          processing_ms: Math.round(processingMs),
          model: outcome.model,
          prompt_version: outcome.prompt_version,
        },
      });

      req.log.info("call processed", {
        intent: payload.data.intent,
        urgency: payload.data.clinical.urgency,
        action: payload.data.recommended_action.type,
        data_quality: payload.meta.data_quality,
        skipped_llm: outcome.skipped_llm,
      });

      res.status(200).json(payload);
    } catch (err) {
      next(err);
    }
  };
}
