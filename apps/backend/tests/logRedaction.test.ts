import { Writable } from "stream";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { REQUEST_LOG_REDACT_CONFIG, createApp } from "../src/app";
import { authenticate } from "./testHelpers";
import { lastConsoleOtpForTests } from "../src/modules/auth/otp.provider";
import { prisma } from "../src/db/prisma";

const FAKE_BEARER_TOKEN = "SECRET_TEST_TOKEN_123";
const FAKE_REQUEST_COOKIE = "SECRET_REQUEST_COOKIE_ABC";
const FAKE_RESPONSE_COOKIE = "SECRET_RESPONSE_COOKIE_XYZ";

/**
 * Builds a tiny Express app wired with the *exact* redact configuration
 * app.ts uses in production (REQUEST_LOG_REDACT_CONFIG), backed by a real
 * pino-http middleware instance writing to an in-memory stream — so these
 * tests exercise the real logger/redaction engine on a real HTTP
 * round-trip (via supertest), not just the shape of a config object.
 */
function buildCapturingApp() {
  const chunks: string[] = [];
  const captureStream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  const captureLogger = pino({ level: "info" }, captureStream);

  const app = express();
  app.use(pinoHttp({ logger: captureLogger, autoLogging: true, redact: REQUEST_LOG_REDACT_CONFIG }));
  app.get("/probe", (_req, res) => {
    res.setHeader("Set-Cookie", `newsession=${FAKE_RESPONSE_COOKIE}`);
    res.status(200).json({ ok: true });
  });

  return { app, getLogOutput: () => chunks.join("") };
}

// pino-http logs on the response's "finish" event, which fires on the
// server side essentially as soon as the last byte is handed off — before
// or right around when supertest's client-side promise resolves. A short
// flush guards against any residual scheduling race.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

describe("request log redaction", () => {
  it("redacts the Authorization header and never logs the raw bearer token", async () => {
    const { app, getLogOutput } = buildCapturingApp();

    await request(app).get("/probe").set("Authorization", `Bearer ${FAKE_BEARER_TOKEN}`).expect(200);
    await flush();

    const output = getLogOutput();
    expect(output).not.toContain(FAKE_BEARER_TOKEN);
    expect(output).toContain('"authorization":"[Redacted]"');
  });

  it("redacts the Cookie request header and never logs the raw cookie value", async () => {
    const { app, getLogOutput } = buildCapturingApp();

    await request(app).get("/probe").set("Cookie", `session=${FAKE_REQUEST_COOKIE}`).expect(200);
    await flush();

    const output = getLogOutput();
    expect(output).not.toContain(FAKE_REQUEST_COOKIE);
    expect(output).toContain('"cookie":"[Redacted]"');
  });

  it("redacts the Set-Cookie response header and never logs the raw response cookie value", async () => {
    const { app, getLogOutput } = buildCapturingApp();

    await request(app).get("/probe").expect(200);
    await flush();

    const output = getLogOutput();
    expect(output).not.toContain(FAKE_RESPONSE_COOKIE);
    expect(output).toContain('"set-cookie":"[Redacted]"');
  });

  it("redacts Authorization, Cookie, and Set-Cookie together on the same request without leaking any of them", async () => {
    const { app, getLogOutput } = buildCapturingApp();

    await request(app)
      .get("/probe")
      .set("Authorization", `Bearer ${FAKE_BEARER_TOKEN}`)
      .set("Cookie", `session=${FAKE_REQUEST_COOKIE}`)
      .expect(200);
    await flush();

    const output = getLogOutput();
    expect(output).not.toContain(FAKE_BEARER_TOKEN);
    expect(output).not.toContain(FAKE_REQUEST_COOKIE);
    expect(output).not.toContain(FAKE_RESPONSE_COOKIE);
  });

  it("still logs normal, non-sensitive request/response fields", async () => {
    const { app, getLogOutput } = buildCapturingApp();

    await request(app).get("/probe").set("Authorization", `Bearer ${FAKE_BEARER_TOKEN}`).expect(200);
    await flush();

    const parsedLines = getLogOutput()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const completedLine = parsedLines.find((line) => line.req && line.res);

    expect(completedLine).toBeDefined();
    expect(completedLine.req.method).toBe("GET");
    expect(completedLine.req.url).toBe("/probe");
    expect(completedLine.res.statusCode).toBe(200);
  });

  it("does not redact harmless headers", async () => {
    const { app, getLogOutput } = buildCapturingApp();

    await request(app).get("/probe").set("User-Agent", "phase-7-test-agent").expect(200);
    await flush();

    expect(getLogOutput()).toContain('"user-agent":"phase-7-test-agent"');
  });
});

describe("OTP logging safety (confirms, does not duplicate, the Step 1 production guard)", () => {
  const app = createApp();
  const TEST_PHONE = "+919876502001";

  afterAll(async () => {
    await prisma.otpChallenge.deleteMany({ where: { phone: TEST_PHONE } });
    await prisma.user.deleteMany({ where: { phone: TEST_PHONE } });
    await prisma.$disconnect();
  });

  it("leaves development/test console-OTP behavior unchanged", async () => {
    await authenticate(app, TEST_PHONE);
    expect(lastConsoleOtpForTests?.phone).toBe(TEST_PHONE);
    expect(lastConsoleOtpForTests?.code).toMatch(/^\d{6}$/);
  });

  it("cannot boot with OTP_PROVIDER=console under NODE_ENV=production, so the console OTP log line is unreachable there", async () => {
    const originalEnv = { ...process.env };
    process.env.NODE_ENV = "production";
    process.env.OTP_PROVIDER = "console";
    process.env.JWT_SECRET = "Zx7!qR9#vL2$mK8@wP4^nT6&hJ1*bC3(dF5)gS0-uY";
    process.env.CORS_ORIGIN = "https://admin.example.com";

    try {
      vi.resetModules();
      await expect(import("../src/config/env")).rejects.toThrow(/OTP_PROVIDER=console is not allowed when NODE_ENV=production/);
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in originalEnv)) delete process.env[key];
      }
      Object.assign(process.env, originalEnv);
      vi.resetModules();
    }
  });
});
