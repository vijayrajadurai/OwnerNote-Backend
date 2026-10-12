import { getOk, joinUrl, postJson, type KaiModel, type KaiModelMessage } from "./KaiModel";

/** A model served by Ollama (development, or self-hosted). POST /api/chat, non-streaming. */
export class OllamaModel implements KaiModel {
  readonly provider = "ollama" as const;
  readonly enabled = true;

  constructor(
    private readonly baseUrl: string,
    readonly name: string,
    private readonly timeoutMs: number,
  ) {}

  async complete(messages: KaiModelMessage[], options: { json?: boolean; maxTokens?: number } = {}): Promise<string | null> {
    const data = (await postJson(
      joinUrl(this.baseUrl, "/api/chat"),
      {
        model: this.name,
        messages,
        stream: false,
        ...(options.json ? { format: "json" } : {}),
        options: { temperature: 0.2, num_predict: options.maxTokens ?? 300 },
      },
      this.timeoutMs,
    )) as { message?: { content?: unknown } } | null;
    const content = data?.message?.content;
    return typeof content === "string" && content.trim() ? content.trim() : null;
  }

  async ping(): Promise<boolean> {
    return getOk(joinUrl(this.baseUrl, "/api/tags"), Math.min(this.timeoutMs, 3000));
  }
}
