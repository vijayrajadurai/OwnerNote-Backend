import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// KAI never uses a paid proprietary LLM API: env.ts refuses to boot with one, and needs a URL + name for a local model.
async function importFreshEnv() {
  vi.resetModules();
  return import("../src/config/env");
}

describe("KAI model configuration", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    vi.resetModules();
  });

  it("defaults to the rule-based engine (no model)", async () => {
    delete process.env.KAI_MODEL_PROVIDER;
    const { env } = await importFreshEnv();
    expect(env.KAI_MODEL_PROVIDER).toBe("none");
  });

  it("accepts a local Ollama model", async () => {
    process.env.KAI_MODEL_PROVIDER = "ollama";
    process.env.KAI_MODEL_URL = "http://localhost:11434";
    process.env.KAI_MODEL_NAME = "qwen2.5:7b-instruct";
    const { env } = await importFreshEnv();
    expect(env.KAI_MODEL_PROVIDER).toBe("ollama");
  });

  it("refuses a paid proprietary LLM API", async () => {
    process.env.KAI_MODEL_PROVIDER = "openai-compatible";
    process.env.KAI_MODEL_URL = "https://api.openai.com/v1";
    process.env.KAI_MODEL_NAME = "gpt-4o";
    await expect(importFreshEnv()).rejects.toThrow(/paid proprietary LLM API/);
  });

  it("refuses a model provider without a URL and name", async () => {
    process.env.KAI_MODEL_PROVIDER = "ollama";
    delete process.env.KAI_MODEL_URL;
    delete process.env.KAI_MODEL_NAME;
    await expect(importFreshEnv()).rejects.toThrow(/KAI_MODEL_URL and KAI_MODEL_NAME/);
  });

  it("knows the proprietary hosts, and not a self-hosted one", async () => {
    const { isProprietaryModelHost } = await importFreshEnv();
    expect(isProprietaryModelHost("https://api.anthropic.com/v1")).toBe(true);
    expect(isProprietaryModelHost("https://generativelanguage.googleapis.com")).toBe(true);
    expect(isProprietaryModelHost("https://my-shop.openai.azure.com")).toBe(true);
    expect(isProprietaryModelHost("http://10.0.0.5:8000/v1")).toBe(false);
    expect(isProprietaryModelHost("https://kai-model.ownernote.in")).toBe(false);
  });
});
