import type { GenerateTextRequest, GenerateTextResult, LLMProvider, ProviderCapabilities } from "./types.ts";

interface AnthropicMessageResponse {
  content?: Array<{
    type: string;
    text?: string;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic" as const;
  readonly capabilities: ProviderCapabilities = {
    supportsTools: false,
    supportsStructuredOutput: false
  };

  constructor(private readonly apiKey: string) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async generateText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: request.model,
        system: request.systemPrompt,
        max_tokens: request.maxTokens ?? 700,
        temperature: request.temperature ?? 0.2,
        messages: [
          {
            role: "user",
            content: request.prompt
          }
        ]
      })
    });

    const payload = (await response.json()) as AnthropicMessageResponse;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? "Anthropic request failed");
    }

    const text = (payload.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n")
      .trim();

    return {
      text,
      usage: {
        inputTokens: payload.usage?.input_tokens,
        outputTokens: payload.usage?.output_tokens
      },
      raw: payload
    };
  }

  async streamText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    const result = await this.generateText(request);
    if (result.text) {
      request.onToken?.(result.text);
    }
    return result;
  }
}
