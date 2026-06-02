// Google Gemini adapter (default provider, free tier) via @google/genai.
// Requests JSON output with a low temp, capped tokens, and abort-signal timeout.

import { GoogleGenAI } from "@google/genai";
import { LLMTimeoutError, LLMUnavailableError } from "../../lib/errors.js";
import { buildUserContent } from "../prompt.js";
import { type LLMProvider, type LLMRequest, type LLMResult, parseModelJson } from "../provider.js";

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  /** Call Gemini for an extraction; maps transport/timeout failures to LLM errors. */
  async extract(request: LLMRequest): Promise<LLMResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: buildUserContent(request.transcript),
        config: {
          systemInstruction: request.systemInstruction,
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          responseMimeType: "application/json",
          abortSignal: controller.signal,
        },
      });
      const json = parseModelJson(response.text);
      return { json, model: this.model };
    } catch (err) {
      if (controller.signal.aborted) {
        throw new LLMTimeoutError(`Gemini request timed out after ${request.timeoutMs}ms`, err);
      }
      throw new LLMUnavailableError("Gemini request failed", err);
    } finally {
      clearTimeout(timer);
    }
  }
}
