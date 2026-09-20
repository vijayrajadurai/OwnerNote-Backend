import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These tests exercise apps/backend/src/config/env.ts in isolation — no
// app/db import — by mutating process.env and re-importing the module
// fresh each time (its validation runs at module-load time). A valid
// baseline (DATABASE_URL, a strong JWT secret, an explicit CORS origin,
// and a non-console OTP provider) is set in beforeEach so each test only
// varies the one thing it's actually testing.

const STRONG_PROD_JWT_SECRET = "Zx7!qR9#vL2$mK8@wP4^nT6&hJ1*bC3(dF5)gS0-uY";

async function importFreshEnv() {
  vi.resetModules();
  return import("../src/config/env");
}

describe("environment configuration validation", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/shopai_test";
    process.env.JWT_SECRET = STRONG_PROD_JWT_SECRET;
    process.env.CORS_ORIGIN = "https://admin.example.com";
    process.env.OTP_PROVIDER = "msg91";
    // .env.test enables TEST_LOGIN for the rest of the suite (see
    // authTestLogin.test.ts) — reset it here so tests that aren't about
    // test-login itself aren't tripped by that ambient value.
    process.env.TEST_LOGIN_ENABLED = "false";
    delete process.env.TEST_LOGIN_USERNAME;
    delete process.env.TEST_LOGIN_PASSWORD;
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    vi.resetModules();
  });

  it("allows OTP_PROVIDER=console in development", async () => {
    process.env.NODE_ENV = "development";
    process.env.OTP_PROVIDER = "console";

    const { env } = await importFreshEnv();
    expect(env.NODE_ENV).toBe("development");
    expect(env.OTP_PROVIDER).toBe("console");
  });

  it("allows OTP_PROVIDER=console in test", async () => {
    process.env.NODE_ENV = "test";
    process.env.OTP_PROVIDER = "console";

    const { env } = await importFreshEnv();
    expect(env.NODE_ENV).toBe("test");
    expect(env.OTP_PROVIDER).toBe("console");
  });

  it("allows OTP_PROVIDER=firebase in production when Admin credentials are set", async () => {
    process.env.NODE_ENV = "production";
    process.env.OTP_PROVIDER = "firebase";
    process.env.FIREBASE_PROJECT_ID = "owner-note";
    process.env.FIREBASE_CLIENT_EMAIL = "firebase-adminsdk@owner-note.iam.gserviceaccount.com";
    process.env.FIREBASE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----\\n";

    const { env } = await importFreshEnv();
    expect(env.OTP_PROVIDER).toBe("firebase");
  });

  it("rejects OTP_PROVIDER=firebase in production without Admin credentials", async () => {
    process.env.NODE_ENV = "production";
    process.env.OTP_PROVIDER = "firebase";
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;

    await expect(importFreshEnv()).rejects.toThrow(/OTP_PROVIDER=firebase requires/);
  });

  it("rejects OTP_PROVIDER=console in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.OTP_PROVIDER = "console";

    await expect(importFreshEnv()).rejects.toThrow(/OTP_PROVIDER=console is not allowed when NODE_ENV=production/);
  });

  it("rejects a known placeholder JWT secret in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "change-me-to-a-long-random-string";

    await expect(importFreshEnv()).rejects.toThrow(/JWT_SECRET is set to a known placeholder value/);
  });

  it("rejects an obviously weak (low character-variety) JWT secret in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    await expect(importFreshEnv()).rejects.toThrow(/JWT_SECRET does not have enough character variety/);
  });

  it("rejects a too-short JWT secret in production even though it clears the dev/test minimum", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "sixteen-chars-ok"; // >=16 (dev/test minimum), but <32

    await expect(importFreshEnv()).rejects.toThrow(/JWT_SECRET must be at least 32 characters/);
  });

  it("allows a strong, unique JWT secret in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = STRONG_PROD_JWT_SECRET;

    const { env } = await importFreshEnv();
    expect(env.JWT_SECRET).toBe(STRONG_PROD_JWT_SECRET);
  });

  it("does not leak the actual secret value in the thrown error", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "change-me-to-a-long-random-string";

    try {
      await importFreshEnv();
      expect.unreachable("expected env import to throw");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain("change-me-to-a-long-random-string");
    }
  });

  it("rejects CORS_ORIGIN=\"*\" in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.CORS_ORIGIN = "*";

    await expect(importFreshEnv()).rejects.toThrow(/CORS_ORIGIN="\*" is not allowed when NODE_ENV=production/);
  });

  it("allows an explicit CORS_ORIGIN in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.CORS_ORIGIN = "https://admin.example.com";

    const { env } = await importFreshEnv();
    expect(env.CORS_ORIGIN).toBe("https://admin.example.com");
  });

  it("allows multiple comma-separated CORS origins in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.CORS_ORIGIN = "https://admin.example.com,https://another.example.com";

    const { env } = await importFreshEnv();
    expect(env.CORS_ORIGIN).toBe("https://admin.example.com,https://another.example.com");
  });

  it("rejects a wildcard hidden inside a comma-separated CORS_ORIGIN list in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.CORS_ORIGIN = "https://admin.example.com,*";

    await expect(importFreshEnv()).rejects.toThrow(/CORS_ORIGIN="\*" is not allowed when NODE_ENV=production/);
  });

  it("still allows CORS_ORIGIN=\"*\" in development and test", async () => {
    process.env.NODE_ENV = "development";
    process.env.CORS_ORIGIN = "*";
    process.env.OTP_PROVIDER = "console";

    const { env } = await importFreshEnv();
    expect(env.CORS_ORIGIN).toBe("*");
  });

  it("rejects TEST_LOGIN_ENABLED=true in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.TEST_LOGIN_ENABLED = "true";
    process.env.TEST_LOGIN_USERNAME = "test";
    process.env.TEST_LOGIN_PASSWORD = "test1234";

    await expect(importFreshEnv()).rejects.toThrow(/TEST_LOGIN_ENABLED=true is not allowed when NODE_ENV=production/);
  });

  it("rejects TEST_LOGIN_ENABLED=true without both username and password, even outside production", async () => {
    process.env.NODE_ENV = "development";
    process.env.OTP_PROVIDER = "console";
    process.env.TEST_LOGIN_ENABLED = "true";

    await expect(importFreshEnv()).rejects.toThrow(
      /TEST_LOGIN_ENABLED=true requires both TEST_LOGIN_USERNAME and TEST_LOGIN_PASSWORD/,
    );
  });

  it("allows TEST_LOGIN_ENABLED=true with both credentials set outside production", async () => {
    process.env.NODE_ENV = "development";
    process.env.OTP_PROVIDER = "console";
    process.env.TEST_LOGIN_ENABLED = "true";
    process.env.TEST_LOGIN_USERNAME = "test";
    process.env.TEST_LOGIN_PASSWORD = "test1234";

    const { env } = await importFreshEnv();
    expect(env.TEST_LOGIN_ENABLED).toBe(true);
  });

  it("defaults TEST_LOGIN_ENABLED to false when unset", async () => {
    process.env.NODE_ENV = "development";
    process.env.OTP_PROVIDER = "console";
    delete process.env.TEST_LOGIN_ENABLED;

    const { env } = await importFreshEnv();
    expect(env.TEST_LOGIN_ENABLED).toBe(false);
  });
});
