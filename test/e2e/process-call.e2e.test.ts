import type { Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { LLMTimeoutError, LLMUnavailableError } from "../../src/lib/errors.js";
import { createLogger } from "../../src/lib/logger.js";
import { FakeProvider } from "../../src/llm/providers/fake.js";
import { ProcessCallResponseSchema } from "../../src/schemas/response.js";

/** A silent logger (captured sink) so test output stays clean. */
const silentLogger = createLogger({ level: "error", sink: () => {} });

function makeApp(provider = new FakeProvider()): Express {
  const env = loadEnv({
    LLM_PROVIDER: "fake",
    MIN_MEANINGFUL_TRANSCRIPT_CHARS: "15",
    MAX_TRANSCRIPT_CHARS: "200",
  } as NodeJS.ProcessEnv);
  return buildApp({ env, provider, logger: silentLogger });
}

describe("POST /process-call", () => {
  let app: Express;
  beforeEach(() => {
    app = makeApp();
  });

  it("processes the brief's example into the expected structure (200)", async () => {
    const res = await request(app).post("/process-call").send({
      transcript:
        "Hi, I've had a really bad cough for 5 days and I'd like to see a doctor. My name is John Smith and my date of birth is 2nd Jan 1990.",
    });

    expect(res.status).toBe(200);
    // Response always conforms to the contract (output validation).
    expect(ProcessCallResponseSchema.safeParse(res.body).success).toBe(true);

    expect(res.body.data.patient.name).toBe("John Smith");
    expect(res.body.data.patient.date_of_birth).toBe("1990-01-02");
    expect(res.body.data.clinical.symptoms).toContain("cough");
    expect(res.body.data.intent).toBe("book_appointment");
    expect(res.body.data.recommended_action).toEqual({
      type: "book_appointment",
      mode: "gp_consultation",
    });
    expect(res.body.meta.data_quality).toBe("complete");
    expect(res.body.meta.model.provider).toBe("fake");
  });

  it("escalates an emergency to direct_to_emergency regardless of intent (200)", async () => {
    const res = await request(app)
      .post("/process-call")
      .send({ transcript: "My husband has really bad chest pain and can't breathe, please help!" });

    expect(res.status).toBe(200);
    expect(res.body.data.recommended_action.type).toBe("direct_to_emergency");
    expect(res.body.data.clinical.urgency).toBe("emergency");
  });

  it("handles a vague but valid transcript gracefully (200, partial/insufficient)", async () => {
    const res = await request(app)
      .post("/process-call")
      .send({ transcript: "Um hello, I think I maybe need some help with something." });

    expect(res.status).toBe(200);
    expect(["partial", "insufficient"]).toContain(res.body.meta.data_quality);
    expect(res.body.data.recommended_action.type).toBe("request_more_info");
    expect(res.body.meta.warnings.length).toBeGreaterThan(0);
  });

  it("skips the LLM for a trivially short transcript (200 insufficient)", async () => {
    // Provider that would throw if called — proves we never call it.
    const exploding = new FakeProvider({ failWith: new Error("should not be called") });
    const localApp = makeApp(exploding);

    const res = await request(localApp).post("/process-call").send({ transcript: "hi" });

    expect(res.status).toBe(200);
    expect(res.body.meta.data_quality).toBe("insufficient");
    expect(res.body.data.recommended_action.type).toBe("request_more_info");
    expect(res.body.meta.model.name).toBe("none");
  });

  it("rejects a missing transcript (400)", async () => {
    const res = await request(app).post("/process-call").send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_request");
    expect(res.body.meta.request_id).toBeTruthy();
  });

  it("rejects an empty transcript (400)", async () => {
    const res = await request(app).post("/process-call").send({ transcript: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_request");
  });

  it("rejects an over-long transcript (413)", async () => {
    const res = await request(app)
      .post("/process-call")
      .send({ transcript: "a".repeat(201) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("payload_too_large");
  });

  it("maps a typed provider failure to 502 (provider unavailable)", async () => {
    const failing = new FakeProvider({
      failWith: new LLMUnavailableError("provider exploded"),
    });
    const localApp = makeApp(failing);
    const res = await request(localApp)
      .post("/process-call")
      .send({ transcript: "I have had a sore throat for three days now and need advice." });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("llm_unavailable");
    expect(res.body.meta.request_id).toBeTruthy();
  });

  it("maps a typed provider timeout to 504", async () => {
    const slow = new FakeProvider({ failWith: new LLMTimeoutError("too slow") });
    const localApp = makeApp(slow);
    const res = await request(localApp)
      .post("/process-call")
      .send({ transcript: "I have had a sore throat for three days now and need advice." });
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe("llm_timeout");
  });

  it("propagates an inbound x-request-id into the response header and meta", async () => {
    const res = await request(app)
      .post("/process-call")
      .set("x-request-id", "trace-123")
      .send({ transcript: "I would like to book an appointment to see a doctor please." });

    expect(res.headers["x-request-id"]).toBe("trace-123");
    expect(res.body.meta.request_id).toBe("trace-123");
  });
});

describe("GET /health", () => {
  it("returns 200 ok without invoking the provider", async () => {
    const exploding = new FakeProvider({ failWith: new Error("should not be called") });
    const res = await request(makeApp(exploding)).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
