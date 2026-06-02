/*
 * Extraction contract: what the LLM is asked to produce and the shape we
 * re-validate every response against. We NEVER trust the model's JSON — only
 * validated Extraction objects reach the decision engine. The LLM extracts
 * only; off-list intents/urgencies are coerced to `unknown` so a creative model
 * can't break the contract.
 */

import { z } from "zod";
import { IntentSchema, UrgencySchema } from "../domain/enums.js";

// Coerce any unrecognised enum value to `unknown` rather than rejecting.
const IntentLenient = z.preprocess(
  (v) => (typeof v === "string" && IntentSchema.safeParse(v).success ? v : "unknown"),
  IntentSchema,
);
const UrgencyLenient = z.preprocess(
  (v) => (typeof v === "string" && UrgencySchema.safeParse(v).success ? v : "unknown"),
  UrgencySchema,
);

export const PatientSchema = z.object({
  name: z.string().trim().min(1).nullable().catch(null),
  // Loose string here; normaliseDateOfBirth is the authority that produces ISO.
  date_of_birth: z.string().trim().min(1).nullable().catch(null),
});
export type Patient = z.infer<typeof PatientSchema>;

export const ClinicalSchema = z.object({
  /** Distinct symptoms mentioned; empty array if none extracted. */
  symptoms: z.array(z.string().trim().min(1)).catch([]),
  /** Free-text duration as stated ("5 days", "a couple of weeks"), or null. */
  duration: z.string().trim().min(1).nullable().catch(null),
  urgency: UrgencyLenient,
});
export type Clinical = z.infer<typeof ClinicalSchema>;

export const ExtractionSchema = z.object({
  patient: PatientSchema,
  clinical: ClinicalSchema,
  intent: IntentLenient,
  /** Model's self-reported overall confidence in [0, 1]. */
  confidence: z.coerce.number().min(0).max(1).catch(0),
  /** Optional human-readable notes about gaps/ambiguity, surfaced as warnings. */
  notes: z.array(z.string()).catch([]).optional(),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

/** Safe empty extraction used when the LLM is skipped or fails (→ 200 + request_more_info). */
export function emptyExtraction(): Extraction {
  return {
    patient: { name: null, date_of_birth: null },
    clinical: { symptoms: [], duration: null, urgency: "unknown" },
    intent: "unknown",
    confidence: 0,
    notes: [],
  };
}
