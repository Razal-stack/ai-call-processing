import { describe, expect, it } from "vitest";
import { ExtractionSchema, emptyExtraction } from "../../src/schemas/extraction.js";
import { ProcessCallRequestSchema } from "../../src/schemas/request.js";
import { ProcessCallResponseSchema } from "../../src/schemas/response.js";

describe("ProcessCallRequestSchema (400 boundary)", () => {
  it("accepts a non-empty transcript and trims it", () => {
    const parsed = ProcessCallRequestSchema.parse({ transcript: "  hi there  " });
    expect(parsed.transcript).toBe("hi there");
  });

  it("rejects a missing transcript", () => {
    expect(ProcessCallRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a non-string transcript", () => {
    expect(ProcessCallRequestSchema.safeParse({ transcript: 123 }).success).toBe(false);
  });

  it("rejects an empty / whitespace-only transcript", () => {
    expect(ProcessCallRequestSchema.safeParse({ transcript: "" }).success).toBe(false);
    expect(ProcessCallRequestSchema.safeParse({ transcript: "   " }).success).toBe(false);
  });

  it("rejects unknown extra keys (strict)", () => {
    expect(ProcessCallRequestSchema.safeParse({ transcript: "ok", extra: 1 }).success).toBe(false);
  });
});

describe("ExtractionSchema (never trust the model)", () => {
  it("coerces an off-list intent to unknown instead of rejecting", () => {
    const parsed = ExtractionSchema.parse({
      patient: { name: "A", date_of_birth: null },
      clinical: { symptoms: [], duration: null, urgency: "routine" },
      intent: "make_me_a_sandwich",
      confidence: 0.5,
    });
    expect(parsed.intent).toBe("unknown");
  });

  it("coerces an off-list urgency to unknown", () => {
    const parsed = ExtractionSchema.parse({
      patient: { name: null, date_of_birth: null },
      clinical: { symptoms: [], duration: null, urgency: "VERY_BAD" },
      intent: "unknown",
      confidence: 0.5,
    });
    expect(parsed.clinical.urgency).toBe("unknown");
  });

  it("clamps/catches an out-of-range or non-numeric confidence to 0", () => {
    const parsed = ExtractionSchema.parse({
      patient: { name: null, date_of_birth: null },
      clinical: { symptoms: [], duration: null, urgency: "routine" },
      intent: "unknown",
      confidence: "not a number",
    });
    expect(parsed.confidence).toBe(0);
  });

  it("keeps a raw (non-ISO) date_of_birth string for normalisation downstream", () => {
    // The schema no longer enforces ISO; normaliseDateOfBirth is the authority
    // that converts "2nd Jan 1990" → "1990-01-02" in the extraction service.
    const parsed = ExtractionSchema.parse({
      patient: { name: null, date_of_birth: "2nd Jan 1990" },
      clinical: { symptoms: [], duration: null, urgency: "routine" },
      intent: "unknown",
      confidence: 0.5,
    });
    expect(parsed.patient.date_of_birth).toBe("2nd Jan 1990");
  });

  it("emptyExtraction conforms to the schema", () => {
    expect(ExtractionSchema.safeParse(emptyExtraction()).success).toBe(true);
  });
});

describe("ProcessCallResponseSchema (output boundary)", () => {
  it("validates a well-formed response payload", () => {
    const ok = ProcessCallResponseSchema.safeParse({
      data: {
        patient: { name: "John Smith", date_of_birth: "1990-01-02" },
        clinical: { symptoms: ["cough"], duration: "5 days", urgency: "routine" },
        intent: "book_appointment",
        confidence: 0.85,
        recommended_action: { type: "book_appointment", mode: "gp_consultation" },
      },
      meta: {
        request_id: "abc",
        data_quality: "complete",
        warnings: [],
        processing_ms: 12,
        model: { provider: "fake", name: "fake-model-1" },
        prompt_version: "x",
      },
    });
    expect(ok.success).toBe(true);
  });

  it("rejects an action type outside the closed set", () => {
    const bad = ProcessCallResponseSchema.safeParse({
      data: {
        patient: { name: null, date_of_birth: null },
        clinical: { symptoms: [], duration: null, urgency: "routine" },
        intent: "book_appointment",
        confidence: 0.85,
        recommended_action: { type: "send_flowers", mode: "none" },
      },
      meta: {
        request_id: "abc",
        data_quality: "complete",
        warnings: [],
        processing_ms: 12,
        model: { provider: "fake", name: "x" },
        prompt_version: "x",
      },
    });
    expect(bad.success).toBe(false);
  });
});
