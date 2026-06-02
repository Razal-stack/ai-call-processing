/*
 * Deterministic in-memory provider for tests and key-free CI — no network. Maps
 * a transcript to a canned extraction via keyword heuristics. Can be driven with
 * `scripted` (exact-transcript overrides) or `failWith` (simulate 502/504).
 */

import type { LLMProvider, LLMRequest, LLMResult } from "../provider.js";

export interface FakeProviderOptions {
  /** Exact-transcript → raw JSON overrides (highest priority). */
  scripted?: Record<string, unknown>;
  /** If set, every call throws this error (to test provider failures). */
  failWith?: Error;
  /** Model name to report. */
  model?: string;
}

export class FakeProvider implements LLMProvider {
  readonly name = "fake";
  private readonly opts: FakeProviderOptions;

  constructor(opts: FakeProviderOptions = {}) {
    this.opts = opts;
  }

  // Returns a resolved Promise to satisfy the interface; no real I/O is done.
  extract(request: LLMRequest): Promise<LLMResult> {
    if (this.opts.failWith) {
      return Promise.reject(this.opts.failWith);
    }
    const model = this.opts.model ?? "fake-model-1";

    const scripted = this.opts.scripted?.[request.transcript];
    if (scripted !== undefined) {
      return Promise.resolve({ json: scripted, model });
    }

    return Promise.resolve({ json: heuristicExtraction(request.transcript), model });
  }
}

/** Lightweight keyword heuristics → an extraction-shaped object. */
function heuristicExtraction(transcript: string): unknown {
  const text = transcript.toLowerCase();

  const symptoms: string[] = [];
  const symptomMap: Record<string, string> = {
    cough: "cough",
    fever: "fever",
    "sore throat": "sore throat",
    headache: "headache",
    "chest pain": "chest pain",
    "struggling to breathe": "struggling to breathe",
    "difficulty breathing": "difficulty breathing",
    rash: "rash",
  };
  for (const [needle, label] of Object.entries(symptomMap)) {
    if (text.includes(needle)) {
      symptoms.push(label);
    }
  }

  let urgency = "routine";
  if (
    text.includes("chest pain") ||
    text.includes("breathe") ||
    text.includes("emergency") ||
    text.includes("unconscious")
  ) {
    urgency = "emergency";
  } else if (text.includes("urgent") || text.includes("as soon as possible")) {
    urgency = "urgent";
  }

  let intent = "unknown";
  if (text.includes("prescription") || text.includes("repeat") || text.includes("inhaler")) {
    intent = "request_prescription";
  } else if (text.includes("cancel") || text.includes("reschedule")) {
    intent = "cancel_or_reschedule";
  } else if (
    text.includes("see a doctor") ||
    text.includes("appointment") ||
    text.includes("book")
  ) {
    intent = "book_appointment";
  } else if (text.includes("advice") || symptoms.length > 0) {
    intent = "medical_advice";
  }

  const nameMatch = transcript.match(/(?:my name is|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  const dobMatch = transcript.match(/(\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4})/i);

  const confidence = intent === "unknown" && symptoms.length === 0 ? 0.2 : 0.85;

  return {
    patient: {
      name: nameMatch?.[1] ?? null,
      date_of_birth: dobMatch?.[1] ?? null,
    },
    clinical: {
      symptoms,
      duration:
        text
          .match(/for\s+([\w\s]+?(?:days|day|weeks|week|months|month|hours|hour))/)?.[1]
          ?.trim() ?? null,
      urgency,
    },
    intent,
    confidence,
    notes: [],
  };
}
