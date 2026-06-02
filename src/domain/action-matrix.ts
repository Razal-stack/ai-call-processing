// The clinical decision policy as data — readable top-to-bottom by a clinical
// reviewer, with no control flow. The pure decision.engine consumes this table.
// Note: `request_more_info` is an ActionType with mode "none", not a mode.

import type { Intent, Mode, RecommendedAction, Urgency } from "./enums.js";

// Total intent × urgency → action policy (the Record types make it exhaustive).
// `unknown` rows gather info / escalate rather than guess.
export const ACTION_MATRIX: Record<Intent, Record<Urgency, RecommendedAction>> = {
  book_appointment: {
    emergency: { type: "direct_to_emergency", mode: "none" },
    urgent: { type: "escalate_to_nurse", mode: "telephone_callback" },
    routine: { type: "book_appointment", mode: "gp_consultation" },
    unknown: { type: "book_appointment", mode: "gp_consultation" },
  },
  request_prescription: {
    emergency: { type: "direct_to_emergency", mode: "none" },
    urgent: { type: "escalate_to_nurse", mode: "telephone_callback" },
    routine: { type: "issue_prescription_request", mode: "none" },
    unknown: { type: "issue_prescription_request", mode: "none" },
  },
  medical_advice: {
    emergency: { type: "direct_to_emergency", mode: "none" },
    urgent: { type: "escalate_to_nurse", mode: "telephone_callback" },
    routine: { type: "escalate_to_nurse", mode: "telephone_callback" },
    unknown: { type: "escalate_to_nurse", mode: "telephone_callback" },
  },
  cancel_or_reschedule: {
    // Cancelling never carries clinical urgency; treat all the same.
    emergency: { type: "book_appointment", mode: "gp_consultation" },
    urgent: { type: "book_appointment", mode: "gp_consultation" },
    routine: { type: "book_appointment", mode: "gp_consultation" },
    unknown: { type: "book_appointment", mode: "gp_consultation" },
  },
  general_enquiry: {
    emergency: { type: "direct_to_emergency", mode: "none" },
    urgent: { type: "escalate_to_staff", mode: "telephone_callback" },
    routine: { type: "escalate_to_staff", mode: "none" },
    unknown: { type: "escalate_to_staff", mode: "none" },
  },
  unknown: {
    // Intent unclear but the patient signalled an emergency → still escalate.
    emergency: { type: "direct_to_emergency", mode: "none" },
    urgent: { type: "escalate_to_staff", mode: "telephone_callback" },
    routine: { type: "request_more_info", mode: "none" },
    unknown: { type: "request_more_info", mode: "none" },
  },
};

/** The action returned when we have too little to safely act on. */
export const INSUFFICIENT_ACTION: RecommendedAction = {
  type: "request_more_info",
  mode: "none",
};

/** The action returned for any emergency, regardless of intent. */
export const EMERGENCY_ACTION: RecommendedAction = {
  type: "direct_to_emergency",
  mode: "none",
};

// Red-flag patterns force an emergency escalation regardless of LLM intent/urgency
// — the deterministic safety net. Matched case-insensitively as substrings.
// Conservative and explicit; this is where a clinical reviewer would extend.
export const RED_FLAG_PATTERNS: readonly string[] = [
  "chest pain",
  "tightness in chest",
  "difficulty breathing",
  "shortness of breath",
  "can't breathe",
  "cannot breathe",
  "struggling to breathe",
  "unconscious",
  "unresponsive",
  "stroke",
  "face drooping",
  "slurred speech",
  "severe bleeding",
  "heavy bleeding",
  "anaphylaxis",
  "severe allergic reaction",
  "suicidal",
  "overdose",
  "seizure",
  "blue lips",
  "choking",
];

/** True if any extracted symptom matches a red-flag pattern (case-insensitive). */
export function hasRedFlag(symptoms: readonly string[]): boolean {
  return symptoms.some((symptom) => {
    const s = symptom.toLowerCase();
    return RED_FLAG_PATTERNS.some((pattern) => s.includes(pattern));
  });
}

/** Normal-path action for a resolved (intent, urgency) pair. */
export function lookupAction(intent: Intent, urgency: Urgency): RecommendedAction {
  return ACTION_MATRIX[intent][urgency];
}

export type { Mode };
