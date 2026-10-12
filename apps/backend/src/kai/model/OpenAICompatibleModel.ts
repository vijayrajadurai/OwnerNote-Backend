import { getOk, joinUrl, postJson, type KaiModel, type KaiModelMessage } from "./KaiModel";

/**
 * A self-hosted open-weight model behind the common "/v1/chat/completions" shape (vLLM, llama.cpp server, LocalAI,
 * Ollama's /v1). Only our own server: env.ts refuses to boot with a paid proprietary API host.
 */
export class OpenAICompatibleModel implements KaiModel {
  readonly provider = "openai-compatible" as const;
  readonly enabled = true;
  private readonly root: string;

  constructor(
    baseUrl: string,
    readonly name: string,
    private readonly timeoutMs: number,
    private readonly apiKey?: string,
  ) {
    this.root = /\/v1\/?$/.test(baseUrl) ? baseUrl.replace(/\/+$/, "") : joinUrl(baseUrl, "/v1");
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
  }

  async complete(messages: KaiModelMessage[], options: { json?: boolean; maxTokens?: number } = {}): Promise<string | null> {
    const data = (await postJson(
      `${this.root}/chat/completions`,
      {
        model: this.name,
        messages,
        temperature: 0.2,
        max_tokens: options.maxTokens ?? 300,
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      },
      this.timeoutMs,
      this.headers(),
    )) as { choices?: { message?: { content?: unknown } }[] } | null;
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === "string" && content.trim() ? content.trim() : null;
  }

  async ping(): Promise<boolean> {
    return getOk(`${this.root}/models`, Math.min(this.timeoutMs, 3000), this.headers());
  }
}
