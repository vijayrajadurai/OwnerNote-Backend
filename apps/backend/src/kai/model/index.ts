import { env } from "../../config/env";
import { RuleBasedOnly, type KaiModel } from "./KaiModel";
import { OllamaModel } from "./OllamaModel";
import { OpenAICompatibleModel } from "./OpenAICompatibleModel";

let current: KaiModel | null = null;

function fromEnv(): KaiModel {
  if (env.KAI_MODEL_PROVIDER === "ollama" && env.KAI_MODEL_URL && env.KAI_MODEL_NAME) {
    return new OllamaModel(env.KAI_MODEL_URL, env.KAI_MODEL_NAME, env.KAI_MODEL_TIMEOUT_MS);
  }
  if (env.KAI_MODEL_PROVIDER === "openai-compatible" && env.KAI_MODEL_URL && env.KAI_MODEL_NAME) {
    return new OpenAICompatibleModel(env.KAI_MODEL_URL, env.KAI_MODEL_NAME, env.KAI_MODEL_TIMEOUT_MS, env.KAI_MODEL_API_KEY);
  }
  return new RuleBasedOnly();
}

export function kaiModel(): KaiModel {
  current ??= fromEnv();
  return current;
}

/** Tests swap in a fake model (and null puts the configured one back). */
export function setKaiModelForTests(model: KaiModel | null): void {
  current = model;
}

export type { KaiModel, KaiModelMessage } from "./KaiModel";
