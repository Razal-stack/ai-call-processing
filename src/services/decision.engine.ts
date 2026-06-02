// The deterministic, auditable core. Decides the action from a validated
// Extraction — the LLM never does. Three layers, applied IN ORDER (the order is
// a safety property): 1. safety override (red flags → emergency, beats all),
// 2. sufficiency gate (low signal/confidence → request_more_info, don't guess),
// 3. matrix lookup. Pure: no I/O, no Date, no randomness.

import {
  EMERGENCY_ACTION,
  hasRedFlag,
  INSUFFICIENT_ACTION,
  lookupAction,
} from "../domain/action-matrix.js";
import type { DataQuality, RecommendedAction } from "../domain/enums.js";
import type { Extraction } from "../schemas/extraction.js";

/**
 * Result of the decision engine: the deterministic action plus the derived
 * signals (quality + confidence + warnings) the controller assembles into `meta`.
 */
export interface Decision {
  recommended_action: RecommendedAction;
  data_quality: DataQuality;
  /** Aggregated confidence after deterministic adjustments, in [0, 1]. */
  confidence: number;
  /** Human-readable notes about gaps/overrides applied. */
  warnings: string[];
}

/** Below this confidence we don't act on the matrix (emergencies bypass it). */
export const MIN_ACT_CONFIDENCE = 0.4;

/** At/above this (with known intent + name + dob) data is `complete`. */
export const COMPLETE_CONFIDENCE = 0.7;

/** Enough signal to attempt the matrix: known intent, a symptom, or non-routine urgency. */
function hasUsableSignal(extraction: Extraction): boolean {
  const { intent, clinical } = extraction;
  return (
    intent !== "unknown" ||
    clinical.symptoms.length > 0 ||
    (clinical.urgency !== "unknown" && clinical.urgency !== "routine")
  );
}

/** Derive the data-quality flag from what was actually extracted. */
function assessQuality(extraction: Extraction): Decision["data_quality"] {
  if (!hasUsableSignal(extraction)) {
    return "insufficient";
  }
  const hasName = extraction.patient.name !== null;
  const hasDob = extraction.patient.date_of_birth !== null;
  const confident = extraction.confidence >= COMPLETE_CONFIDENCE;
  const intentKnown = extraction.intent !== "unknown";

  return confident && intentKnown && hasName && hasDob ? "complete" : "partial";
}

/** Decide the recommended action for an extraction. Pure. */
export function decide(extraction: Extraction): Decision {
  const warnings: string[] = [];
  const { clinical, intent, confidence } = extraction;

  // 1. SAFETY OVERRIDE — red flags beat everything.
  if (hasRedFlag(clinical.symptoms)) {
    warnings.push("Red-flag symptom detected; escalated to emergency regardless of stated intent.");
    return {
      recommended_action: EMERGENCY_ACTION,
      // An emergency is, by definition, actionable and high-signal.
      data_quality: "complete",
      confidence: Math.max(confidence, 0.99),
      warnings,
    };
  }

  // Explicit emergency urgency (without a matched red-flag phrase) still escalates.
  if (clinical.urgency === "emergency") {
    warnings.push("Emergency urgency reported; routed to emergency services.");
    return {
      recommended_action: EMERGENCY_ACTION,
      data_quality: "complete",
      confidence: Math.max(confidence, 0.95),
      warnings,
    };
  }

  // 2. SUFFICIENCY GATE — too little signal, or too little confidence.
  const quality = assessQuality(extraction);

  if (quality === "insufficient") {
    warnings.push("Transcript did not contain enough information to act on.");
    return {
      recommended_action: INSUFFICIENT_ACTION,
      data_quality: "insufficient",
      confidence,
      warnings,
    };
  }

  if (confidence < MIN_ACT_CONFIDENCE) {
    warnings.push(
      `Extraction confidence (${confidence.toFixed(2)}) below threshold (${MIN_ACT_CONFIDENCE}); requesting more information.`,
    );
    return {
      recommended_action: INSUFFICIENT_ACTION,
      data_quality: "partial",
      confidence,
      warnings,
    };
  }

  // 3. MATRIX LOOKUP — the normal path.
  collectGapWarnings(extraction, warnings);
  return {
    recommended_action: lookupAction(intent, clinical.urgency),
    data_quality: quality,
    confidence,
    warnings,
  };
}

/** Note missing patient fields and LLM ambiguity notes for `meta.warnings`. */
function collectGapWarnings(extraction: Extraction, warnings: string[]): void {
  if (extraction.patient.name === null) {
    warnings.push("Patient name was not stated.");
  }
  if (extraction.patient.date_of_birth === null) {
    warnings.push("Date of birth was not stated or could not be parsed.");
  }
  if (extraction.clinical.urgency === "unknown") {
    warnings.push("Urgency was unclear; treated conservatively.");
  }
  // Surface any notes the LLM itself flagged about ambiguity.
  for (const note of extraction.notes ?? []) {
    warnings.push(note);
  }
}
