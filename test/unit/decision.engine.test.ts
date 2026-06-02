import { describe, expect, it } from "vitest";
import { ACTION_MATRIX, RED_FLAG_PATTERNS } from "../../src/domain/action-matrix.js";
import { ACTION_TYPES, INTENTS, MODES, URGENCIES } from "../../src/domain/enums.js";
import { type Extraction, emptyExtraction } from "../../src/schemas/extraction.js";
import {
  COMPLETE_CONFIDENCE,
  decide,
  MIN_ACT_CONFIDENCE,
} from "../../src/services/decision.engine.js";

/** Build a confident, complete extraction, overriding specific fields. */
function extraction(overrides: Partial<Extraction> = {}): Extraction {
  return {
    patient: { name: "John Smith", date_of_birth: "1990-01-02" },
    clinical: { symptoms: ["cough"], duration: "5 days", urgency: "routine" },
    intent: "book_appointment",
    confidence: 0.9,
    notes: [],
    ...overrides,
  };
}

describe("decision engine — matrix integrity", () => {
  it("the matrix is total: every intent × urgency resolves to a valid action+mode", () => {
    for (const intent of INTENTS) {
      for (const urgency of URGENCIES) {
        const action = ACTION_MATRIX[intent][urgency];
        expect(ACTION_TYPES, `${intent}/${urgency} type`).toContain(action.type);
        expect(MODES, `${intent}/${urgency} mode`).toContain(action.mode);
      }
    }
  });

  it("every emergency cell routes to direct_to_emergency", () => {
    for (const intent of INTENTS) {
      // cancel_or_reschedule has no clinical urgency meaning; excluded by design.
      if (intent === "cancel_or_reschedule") {
        continue;
      }
      expect(ACTION_MATRIX[intent].emergency.type, intent).toBe("direct_to_emergency");
    }
  });
});

describe("decision engine — happy path matrix lookup", () => {
  it("books a routine GP consultation for a confident booking intent", () => {
    const d = decide(extraction());
    expect(d.recommended_action).toEqual({ type: "book_appointment", mode: "gp_consultation" });
    expect(d.data_quality).toBe("complete");
  });

  it("routes routine prescription requests to issue_prescription_request", () => {
    const d = decide(
      extraction({
        intent: "request_prescription",
        clinical: { symptoms: [], duration: null, urgency: "routine" },
      }),
    );
    expect(d.recommended_action).toEqual({ type: "issue_prescription_request", mode: "none" });
  });

  it("escalates urgent bookings to a nurse callback", () => {
    const d = decide(
      extraction({ clinical: { symptoms: ["fever"], duration: "2 days", urgency: "urgent" } }),
    );
    expect(d.recommended_action).toEqual({ type: "escalate_to_nurse", mode: "telephone_callback" });
  });
});

describe("decision engine — safety override (highest priority)", () => {
  it.each(RED_FLAG_PATTERNS)("forces emergency on red-flag symptom: %s", (pattern) => {
    const d = decide(
      extraction({
        intent: "general_enquiry",
        confidence: 0.1, // even low confidence must not suppress an emergency
        clinical: { symptoms: [`patient reports ${pattern}`], duration: null, urgency: "routine" },
      }),
    );
    expect(d.recommended_action).toEqual({ type: "direct_to_emergency", mode: "none" });
    expect(d.confidence).toBeGreaterThanOrEqual(0.99);
  });

  it("matches red flags case-insensitively", () => {
    const d = decide(
      extraction({ clinical: { symptoms: ["CHEST PAIN"], duration: null, urgency: "routine" } }),
    );
    expect(d.recommended_action.type).toBe("direct_to_emergency");
  });

  it("escalates on explicit emergency urgency even without a red-flag phrase", () => {
    const d = decide(
      extraction({ clinical: { symptoms: ["unwell"], duration: null, urgency: "emergency" } }),
    );
    expect(d.recommended_action.type).toBe("direct_to_emergency");
  });

  it("red flag beats a low-confidence extraction (does not fall through to request_more_info)", () => {
    const d = decide(
      extraction({
        confidence: 0.05,
        clinical: { symptoms: ["stroke"], duration: null, urgency: "unknown" },
      }),
    );
    expect(d.recommended_action.type).toBe("direct_to_emergency");
  });
});

describe("decision engine — sufficiency gate", () => {
  it("returns insufficient + request_more_info for an empty extraction", () => {
    const d = decide(emptyExtraction());
    expect(d.recommended_action).toEqual({ type: "request_more_info", mode: "none" });
    expect(d.data_quality).toBe("insufficient");
  });

  it("requests more info when confidence is below the act threshold", () => {
    const d = decide(extraction({ confidence: MIN_ACT_CONFIDENCE - 0.01 }));
    expect(d.recommended_action).toEqual({ type: "request_more_info", mode: "none" });
    expect(d.data_quality).toBe("partial");
  });

  it("acts at exactly the act-confidence threshold", () => {
    const d = decide(extraction({ confidence: MIN_ACT_CONFIDENCE }));
    expect(d.recommended_action.type).toBe("book_appointment");
  });

  it("treats a symptom-only transcript as usable signal even with unknown intent", () => {
    const d = decide(
      extraction({
        intent: "unknown",
        confidence: 0.8,
        clinical: { symptoms: ["sore throat"], duration: null, urgency: "routine" },
      }),
    );
    // unknown intent + routine + has symptom → matrix unknown/routine = request_more_info,
    // but quality is partial (not insufficient) because there is a symptom.
    expect(d.data_quality).toBe("partial");
    expect(d.recommended_action.type).toBe("request_more_info");
  });
});

describe("decision engine — data quality assessment", () => {
  it("marks complete only when confident + known intent + name + dob", () => {
    expect(decide(extraction()).data_quality).toBe("complete");
  });

  it("marks partial when the name is missing", () => {
    const d = decide(extraction({ patient: { name: null, date_of_birth: "1990-01-02" } }));
    expect(d.data_quality).toBe("partial");
    expect(d.warnings.join(" ")).toContain("name was not stated");
  });

  it("marks partial when the dob is missing", () => {
    const d = decide(extraction({ patient: { name: "Jane", date_of_birth: null } }));
    expect(d.data_quality).toBe("partial");
    expect(d.warnings.join(" ")).toContain("Date of birth");
  });

  it("marks partial when confidence is below the complete threshold", () => {
    const d = decide(extraction({ confidence: COMPLETE_CONFIDENCE - 0.01 }));
    expect(d.data_quality).toBe("partial");
  });
});

describe("decision engine — warnings", () => {
  it("surfaces LLM-provided notes as warnings on the happy path", () => {
    const d = decide(extraction({ notes: ["DOB year was ambiguous"] }));
    expect(d.warnings).toContain("DOB year was ambiguous");
  });

  it("is pure: same input yields identical output", () => {
    const input = extraction({ confidence: 0.55 });
    expect(decide(input)).toEqual(decide(input));
  });
});
