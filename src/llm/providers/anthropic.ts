// Anthropic (Claude) adapter (Messages REST API). Claude has no hard JSON mode,
// so JSON is instructed via the system prompt + re-validated downstream. Only the
// request shape and response path differ from the shared HttpProvider base.

import { buildUserContent } from "../prompt.js";
import type { LLMRequest } from "../provider.js";
import { HttpProvider } from "./http-provider.js";

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
}

export class AnthropicProvider extends HttpProvider {
  readonly name = "anthropic";

  constructor(
    apiKey: string,
    model: string,
    endpoint: string,
    private readonly apiVersion: string,
  ) {
    super(apiKey, model, endpoint);
  }

  protected buildRequest(request: LLMRequest, signal: AbortSignal): RequestInit {
    return {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": this.apiVersion,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxOutputTokens,
        temperature: request.temperature,
        system: request.systemInstruction,
        messages: [{ role: "user", content: buildUserContent(request.transcript) }],
      }),
      signal,
    };
  }

  protected extractText(body: unknown): string | undefined {
    return (body as AnthropicResponse).content?.find((b) => b.type === "text")?.text;
  }
}
