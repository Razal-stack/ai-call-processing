/*
 * Response contract — the output-validation boundary. The route parses the
 * payload through this before sending, so a bug can't emit an off-contract
 * response. `data` mirrors the brief's shape; `meta` is our traceability add-on.
 */

import { z } from "zod";
import {
  ActionTypeSchema,
  DataQualitySchema,
  IntentSchema,
  ModeSchema,
  UrgencySchema,
} from "../domain/enums.js";

const RecommendedActionSchema = z.object({
  type: ActionTypeSchema,
  mode: ModeSchema,
});

const DataSchema = z.object({
  patient: z.object({
    name: z.string().nullable(),
    date_of_birth: z.string().nullable(),
  }),
  clinical: z.object({
    symptoms: z.array(z.string()),
    duration: z.string().nullable(),
    urgency: UrgencySchema,
  }),
  intent: IntentSchema,
  confidence: z.number().min(0).max(1),
  recommended_action: RecommendedActionSchema,
});

const MetaSchema = z.object({
  /** Correlates the response with logs and the x-request-id header. */
  request_id: z.string(),
  /** complete | partial | insufficient — drives client branching. */
  data_quality: DataQualitySchema,
  /** Human-readable gaps/assumptions ("Date of birth was not mentioned"). */
  warnings: z.array(z.string()),
  /** End-to-end processing time in milliseconds. */
  processing_ms: z.number().nonnegative(),
  /** Which provider/model produced the extraction (proves provider-agnostic). */
  model: z.object({
    provider: z.string(),
    name: z.string(),
  }),
  /** Prompt version that produced the extraction — for output/quality tracing. */
  prompt_version: z.string(),
});

export const ProcessCallResponseSchema = z.object({
  data: DataSchema,
  meta: MetaSchema,
});

export type ProcessCallResponse = z.infer<typeof ProcessCallResponseSchema>;
export type ProcessCallData = z.infer<typeof DataSchema>;
export type ProcessCallMeta = z.infer<typeof MetaSchema>;

/** Consistent error envelope for every controlled error; carries the request id. */
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
  meta: z.object({
    request_id: z.string(),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
