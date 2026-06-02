// Shared base for fetch-based providers (OpenAI, Anthropic). Owns ALL the common
// mechanics — timeout, try/catch/finally, !res.ok handling, JSON parsing, and
// error mapping — so each concrete provider only supplies the 3 things that
// genuinely differ: the request to send and how to pull the text out of the reply.
// (Gemini is NOT built on this: it uses the SDK, a different transport.)

import { LLMTimeoutError, LLMUnavailableError } from "../../lib/errors.js";
import { type LLMProvider, type LLMRequest, type LLMResult, parseModelJson } from "../provider.js";

export abstract class HttpProvider implements LLMProvider {
  abstract readonly name: string;

  constructor(
    protected readonly apiKey: string,
    protected readonly model: string,
    protected readonly endpoint: string,
  ) {}

  /** Build the fetch request for this provider (URL is `this.endpoint`). */
  protected abstract buildRequest(request: LLMRequest, signal: AbortSignal): RequestInit;

  /** Pull the model's text output from the provider's parsed response body. */
  protected abstract extractText(body: unknown): string | undefined;

  /** Template method: run the request with timeout + uniform error handling. */
  async extract(request: LLMRequest): Promise<LLMResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const res = await fetch(this.endpoint, this.buildRequest(request, controller.signal));
      if (!res.ok) {
        throw new LLMUnavailableError(`${this.name} returned ${res.status}`, {
          status: res.status,
          detail: await safeBody(res),
        });
      }
      const json = parseModelJson(this.extractText(await res.json()));
      return { json, model: this.model };
    } catch (err) {
      throw mapFetchError(err, request.timeoutMs, controller, this.name);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Read a truncated error body for logging, tolerating read failures. */
async function safeBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<unreadable>";
  }
}

/** Map a thrown fetch error to a typed LLM error (timeout vs. unavailable). */
function mapFetchError(
  err: unknown,
  timeoutMs: number,
  controller: AbortController,
  provider: string,
): Error {
  if (err instanceof LLMUnavailableError || err instanceof LLMTimeoutError) {
    return err;
  }
  if (controller.signal.aborted) {
    return new LLMTimeoutError(`${provider} request timed out after ${timeoutMs}ms`, err);
  }
  return new LLMUnavailableError(`${provider} request failed`, err);
}
