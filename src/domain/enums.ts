// Closed domain sets — the controlled vocabulary. `as const` + `z.enum` gives a
// runtime validator, a union type, and an iterable list from one declaration (no
// drift). Deliberately not TS `enum` (runtime bloat, poor Zod ergonomics).

import { z } from "zod";

/** What the patient is trying to achieve. Extracted by the LLM. */
export const INTENTS = [
  "book_appointment",
  "request_prescription",
  "medical_advice",
  "cancel_or_reschedule",
  "general_enquiry",
  "unknown",
] as const;
export const IntentSchema = z.enum(INTENTS);
export type Intent = z.infer<typeof IntentSchema>;

/** Clinical urgency. Extracted by the LLM; may be overridden by safety rules. */
export const URGENCIES = ["emergency", "urgent", "routine", "unknown"] as const;
export const UrgencySchema = z.enum(URGENCIES);
export type Urgency = z.infer<typeof UrgencySchema>;

/** What the system should do next. Decided by code, never by the LLM. */
export const ACTION_TYPES = [
  "book_appointment",
  "direct_to_emergency",
  "escalate_to_nurse",
  "issue_prescription_request",
  "request_more_info",
  "escalate_to_staff",
] as const;
export const ActionTypeSchema = z.enum(ACTION_TYPES);
export type ActionType = z.infer<typeof ActionTypeSchema>;

/** The channel/setting of a clinical encounter (or `none` when not applicable). */
export const MODES = [
  "gp_consultation",
  "nurse_consultation",
  "telephone_callback",
  "in_person",
  "none",
] as const;
export const ModeSchema = z.enum(MODES);
export type Mode = z.infer<typeof ModeSchema>;

/** A fully-resolved recommended action. */
export interface RecommendedAction {
  type: ActionType;
  mode: Mode;
}

/**
 * Quality of the extracted data, surfaced in `meta` so callers can branch:
 *  - complete:     all key fields present, confident
 *  - partial:      usable but missing fields or lower confidence
 *  - insufficient: too little to act on (e.g. trivial transcript, no intent)
 */
export const DATA_QUALITIES = ["complete", "partial", "insufficient"] as const;
export const DataQualitySchema = z.enum(DATA_QUALITIES);
export type DataQuality = z.infer<typeof DataQualitySchema>;
