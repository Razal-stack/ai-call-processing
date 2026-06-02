// OpenAI adapter (Chat Completions REST API). Only the request shape and the
// response path differ from the shared HttpProvider base.

import { buildUserContent } from "../prompt.js";
import type { LLMRequest } from "../provider.js";
import { HttpProvider } from "./http-provider.js";

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export class OpenAIProvider extends HttpProvider {
  readonly name = "openai";

  protected buildRequest(request: LLMRequest, signal: AbortSignal): RequestInit {
    return {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: request.temperature,
        max_tokens: request.maxOutputTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.systemInstruction },
          { role: "user", content: buildUserContent(request.transcript) },
        ],
      }),
      signal,
    };
  }

  protected extractText(body: unknown): string | undefined {
    return (body as OpenAIResponse).choices?.[0]?.message?.content;
  }
}
