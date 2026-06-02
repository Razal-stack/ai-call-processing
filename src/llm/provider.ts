/*
 * Provider-agnostic LLM contract (a behavioural interface, so `interface` not a
 * Zod type). Adapters return raw unvalidated JSON — they do NOT validate the
 * shape (that's the extraction service: never trust the model) — and translate
 * transport failures into the typed LLM errors so the HTTP layer maps them.
 */

export interface LLMRequest {
  /** The (already length-checked) patient transcript. */
  transcript: string;
  /** System instruction produced by the prompt builder. */
  systemInstruction: string;
  /** Sampling temperature (low for extraction). */
  temperature: number;
  /** Hard cap on output tokens. */
  maxOutputTokens: number;
  /** Per-call timeout budget in milliseconds. */
  timeoutMs: number;
}

export interface LLMResult {
  /** Raw JSON parsed from the model response — unvalidated. */
  json: unknown;
  /** The concrete model name that served the request (for `meta.model`). */
  model: string;
}

export interface LLMProvider {
  /** Stable provider id, e.g. "gemini" — surfaced in `meta.model.provider`. */
  readonly name: string;
  /** Run extraction. Throws a typed LLM error (502/504) on failure. */
  extract(request: LLMRequest): Promise<LLMResult>;
}

/** Parse a model response to JSON, tolerating code fences / surrounding prose. */
export function parseModelJson(text: string | undefined): unknown {
  if (!text || text.trim() === "") {
    throw new Error("empty model response");
  }
  // Strip markdown code fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to extracting the first {...} balanced-ish block.
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("model response did not contain valid JSON");
  }
}
