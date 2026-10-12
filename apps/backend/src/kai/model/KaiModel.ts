/**
 * The replaceable model seam. KAI runs without any model ("none": the labelled rule-based engine) or with a local /
 * self-hosted open-weight model (Ollama in development; vLLM / llama.cpp / Ollama on our own server in production).
 * A model only phrases replies, answers general (non-record) questions and suggests a read-only intent — it never
 * produces a number shown as a fact, never decides a write and never runs SQL or code.
 */
export interface KaiModelMessage {
  role: "system" | "user";
  content: string;
}

export interface KaiModel {
  readonly provider: "none" | "ollama" | "openai-compatible";
  /** The model's name for the status endpoint (never the URL or a key). */
  readonly name: string;
  readonly enabled: boolean;
  /** The model's text, or null on any failure / timeout (the caller then keeps the rule-based reply). */
  complete(messages: KaiModelMessage[], options?: { json?: boolean; maxTokens?: number }): Promise<string | null>;
  /** Whether the model server answers right now. */
  ping(): Promise<boolean>;
}

export class RuleBasedOnly implements KaiModel {
  readonly provider = "none" as const;
  readonly name = "rule-based";
  readonly enabled = false;
  async complete(): Promise<string | null> {
    return null;
  }
  async ping(): Promise<boolean> {
    return false;
  }
}

/** fetch with a hard timeout; any network error, non-2xx or bad JSON is null. */
export async function postJson(url: string, body: unknown, timeoutMs: number, headers: Record<string, string> = {}): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getOk(url: string, timeoutMs: number, headers: Record<string, string> = {}): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}
