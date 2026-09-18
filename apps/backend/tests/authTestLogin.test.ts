import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";

// .env.test sets TEST_LOGIN_ENABLED=true / TEST_LOGIN_USERNAME=test /
// TEST_LOGIN_PASSWORD=test1234 (see tests/setup.ts), so this app instance
// has the feature turned on — same as CI's backend job env.
const app = createApp();
const TEST_LOGIN_PHONE = "+910000000000";

describe("test login (fixed username/password, non-production only)", () => {
  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { phone: TEST_LOGIN_PHONE } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("logs in with the configured username/password and issues a token", async () => {
    const res = await request(app).post("/auth/test-login").send({ username: "test", password: "test1234" });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTypeOf("string");
    expect(res.body.data.isNewUser).toBe(true);
  });

  it("reuses the same test account on a second login instead of creating a new one", async () => {
    await request(app).post("/auth/test-login").send({ username: "test", password: "test1234" }).expect(200);
    const second = await request(app).post("/auth/test-login").send({ username: "test", password: "test1234" });

    expect(second.status).toBe(200);
    expect(second.body.data.isNewUser).toBe(false);
  });

  it("rejects an incorrect password", async () => {
    const res = await request(app).post("/auth/test-login").send({ username: "test", password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("rejects an incorrect username", async () => {
    const res = await request(app).post("/auth/test-login").send({ username: "not-test", password: "test1234" });
    expect(res.status).toBe(401);
  });

  it("rejects a missing username or password", async () => {
    await request(app).post("/auth/test-login").send({ password: "test1234" }).expect(400);
    await request(app).post("/auth/test-login").send({ username: "test" }).expect(400);
  });
});

describe("test login is a no-op when TEST_LOGIN_ENABLED is not set", () => {
  it("throws even with the right-shaped credentials", async () => {
    vi.resetModules();
    const originalEnabled = process.env.TEST_LOGIN_ENABLED;
    process.env.TEST_LOGIN_ENABLED = "false";

    try {
      const { testLogin } = await import("../src/modules/auth/auth.service");
      await expect(testLogin("test", "test1234")).rejects.toThrow(/Test login is not enabled/);
    } finally {
      process.env.TEST_LOGIN_ENABLED = originalEnabled;
      vi.resetModules();
    }
  });
});
