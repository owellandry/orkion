import OpenAI from "openai";
import type { ProviderName } from "../config/types.ts";
import type {
  GenerateTextRequest,
  GenerateTextResult,
  LLMProvider,
  ProviderCapabilities
} from "./types.ts";

export interface OpenAICompatibleProviderOptions {
  name: ProviderName;
  apiKey: string;
  baseURL: string;
  defaultHeaders?: Record<string, string>;
  maxRetries?: number;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly capabilities: ProviderCapabilities = {
    supportsTools: false,
    supportsStructuredOutput: false
  };

  readonly name: ProviderName;
  private readonly client: OpenAI;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.name = options.name;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      defaultHeaders: options.defaultHeaders,
      maxRetries: options.maxRetries ?? 0
    });
  }

  isConfigured(): boolean {
    return true;
  }

  async generateText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    const completion = await this.client.chat.completions.create({
      model: request.model,
      messages: [
        ...(request.systemPrompt
          ? [{ role: "system" as const, content: request.systemPrompt }]
          : []),
        { role: "user" as const, content: request.prompt }
      ],
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 700
    });

    const text = completion.choices
      .map((choice) => choice.message.content ?? "")
      .join("\n")
      .trim();

    return {
      text,
      usage: {
        inputTokens: completion.usage?.prompt_tokens,
        outputTokens: completion.usage?.completion_tokens
      },
      raw: completion
    };
  }

  async streamText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    const stream = await this.client.chat.completions.create({
      model: request.model,
      messages: [
        ...(request.systemPrompt
          ? [{ role: "system" as const, content: request.systemPrompt }]
          : []),
        { role: "user" as const, content: request.prompt }
      ],
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 700,
      stream: true
    });

    let text = "";

    for await (const chunk of stream) {
      const delta = chunk.choices
        .map((choice) => choice.delta.content ?? "")
        .join("");

      if (!delta) {
        continue;
      }

      text += delta;
      request.onToken?.(delta);
    }

    return {
      text: text.trim(),
      raw: stream
    };
  }
}
