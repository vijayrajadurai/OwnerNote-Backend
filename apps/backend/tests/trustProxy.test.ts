import express from "express";
import rateLimit from "express-rate-limit";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each test needs a *fresh* apps/backend/src/app.ts (and the config/env.ts
// it imports) built against a specific TRUST_PROXY value, since env.ts
// resolves and freezes its config at module-load time. vi.resetModules()
// + a dynamic import gets a clean module graph per test; process.env is
// snapshotted/restored around every test so nothing leaks into other
// files (same pattern already used in envValidation.test.ts).
async function buildFreshApp() {
  vi.resetModules();
  const { createApp } = await import("../src/app");
  return createApp();
}

describe("trust proxy configuration (env.ts -> app.set wiring)", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    vi.resetModules();
  });

  it("preserves current development/test behavior by default (proxy trust disabled)", async () => {
    delete process.env.TRUST_PROXY;

    const app = await buildFreshApp();

    expect(app.get("trust proxy")).toBe(false);
  });

  it("applies a configured TRUST_PROXY hop count to the real Express app", async () => {
    process.env.TRUST_PROXY = "2";

    const app = await buildFreshApp();

    expect(app.get("trust proxy")).toBe(2);
  });

  it("rejects an invalid TRUST_PROXY value (e.g. \"true\") clearly at startup", async () => {
    process.env.TRUST_PROXY = "true";

    await expect(buildFreshApp()).rejects.toThrow(/TRUST_PROXY must be "false" or a non-negative integer/);
  });

  it("boots the real app and still serves requests normally through the full middleware stack", async () => {
    process.env.TRUST_PROXY = "1";

    const app = await buildFreshApp();

    await request(app).get("/health").expect(200, { status: "ok" });
  });
});

describe("Express req.ip resolution for a configured trust-proxy value", () => {
  // Pure Express behavior — not tied to env.ts/app.ts — proving how
  // `app.set("trust proxy", N)` actually resolves req.ip on a real HTTP
  // request, which is the exact behavior app.ts now drives from
  // env.TRUST_PROXY.
  function buildProbeApp(trustProxy: number | false) {
    const app = express();
    app.set("trust proxy", trustProxy);
    app.get("/probe", (req, res) => res.status(200).json({ ip: req.ip }));
    return app;
  }

  it("with one trusted hop, resolves req.ip to the rightmost X-Forwarded-For entry", async () => {
    const app = buildProbeApp(1);

    // Two entries in the header; trusting exactly one hop means Express
    // takes the entry appended by that one trusted proxy (the rightmost).
    const res = await request(app).get("/probe").set("X-Forwarded-For", "1.2.3.4, 5.6.7.8").expect(200);

    expect(res.body.ip).toBe("5.6.7.8");
  });

  it("with two trusted hops, resolves req.ip one entry further back", async () => {
    const app = buildProbeApp(2);

    const res = await request(app).get("/probe").set("X-Forwarded-For", "1.2.3.4, 5.6.7.8").expect(200);

    expect(res.body.ip).toBe("1.2.3.4");
  });

  it("with proxy trust disabled, ignores X-Forwarded-For entirely so a client cannot spoof req.ip", async () => {
    const app = buildProbeApp(false);

    const res = await request(app).get("/probe").set("X-Forwarded-For", "9.9.9.9").expect(200);

    expect(res.body.ip).not.toBe("9.9.9.9");
  });
});

describe("rate limiting keyed by the resolved client IP (not the proxy's IP)", () => {
  // A standalone limiter/app, deliberately separate from the real
  // production config in app.ts (whose 15-minute/600-request thresholds
  // this must not touch) — same express-rate-limit API, a much lower
  // threshold purely so the test runs fast. This proves the *mechanism*
  // the trust-proxy fix exists for: once req.ip is resolved correctly,
  // rate limiting is bucketed per real client instead of lumping every
  // client behind the proxy into one bucket.
  function buildLimitedApp(trustProxy: number | false, validate = true) {
    const app = express();
    app.set("trust proxy", trustProxy);
    app.use(rateLimit({ windowMs: 60 * 1000, limit: 2, standardHeaders: true, legacyHeaders: false, validate }));
    app.get("/probe", (_req, res) => res.status(200).json({ ok: true }));
    return app;
  }

  it("still enforces its limit once a resolved client is over it", async () => {
    const app = buildLimitedApp(1);
    const clientA = "1.1.1.1";

    await request(app).get("/probe").set("X-Forwarded-For", clientA).expect(200);
    await request(app).get("/probe").set("X-Forwarded-For", clientA).expect(200);
    await request(app).get("/probe").set("X-Forwarded-For", clientA).expect(429);
  });

  it("gives a different resolved client IP its own separate bucket", async () => {
    const app = buildLimitedApp(1);
    const clientA = "1.1.1.1";
    const clientB = "2.2.2.2";

    await request(app).get("/probe").set("X-Forwarded-For", clientA).expect(200);
    await request(app).get("/probe").set("X-Forwarded-For", clientA).expect(200);
    await request(app).get("/probe").set("X-Forwarded-For", clientA).expect(429); // client A now over its limit

    // Client B, forwarded through the same trusted proxy, is unaffected.
    await request(app).get("/probe").set("X-Forwarded-For", clientB).expect(200);
  });

  it("without a trusted proxy, every forwarded client collapses onto one bucket (the problem this fix solves)", async () => {
    // express-rate-limit's own runtime sanity check (`validate`) throws on
    // exactly this combination — X-Forwarded-For present while trust proxy
    // is disabled — because it's a likely misconfiguration; that check is
    // disabled here specifically to observe the raw resolution behavior it
    // is warning about. The real app.ts config leaves `validate` at its
    // default (on), so that safety net stays active there.
    const app = buildLimitedApp(false, false);

    await request(app).get("/probe").set("X-Forwarded-For", "1.1.1.1").expect(200);
    await request(app).get("/probe").set("X-Forwarded-For", "2.2.2.2").expect(200);
    await request(app).get("/probe").set("X-Forwarded-For", "3.3.3.3").expect(429);
  });
});
