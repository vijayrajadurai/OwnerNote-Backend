import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { lastConsoleOtpForTests } from "../src/modules/auth/otp.provider";

const app = createApp();
const phone = "+919876500001";

describe("auth flow", () => {
  beforeEach(async () => {
    await prisma.business.deleteMany({});
    await prisma.otpChallenge.deleteMany({ where: { phone } });
    await prisma.user.deleteMany({ where: { phone } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects verify-otp with wrong code", async () => {
    await request(app).post("/auth/send-otp").send({ phone }).expect(200);
    const res = await request(app).post("/auth/verify-otp").send({ phone, code: "000000" });
    expect(res.status).toBe(401);
  });

  it("rejects verify-otp when no OTP was requested", async () => {
    const res = await request(app).post("/auth/verify-otp").send({ phone: "+919876500002", code: "123456" });
    expect(res.status).toBe(401);
  });

  it("validates phone format", async () => {
    const res = await request(app).post("/auth/send-otp").send({ phone: "abc" });
    expect(res.status).toBe(400);
  });

  it("completes send-otp -> verify-otp and issues a token", async () => {
    await request(app).post("/auth/send-otp").send({ phone }).expect(200);
    expect(lastConsoleOtpForTests?.phone).toBe(phone);

    const code = lastConsoleOtpForTests!.code;
    const res = await request(app).post("/auth/verify-otp").send({ phone, code }).expect(200);

    expect(res.body.data.token).toBeTypeOf("string");
    expect(res.body.data.isNewUser).toBe(true);
  });

  it("lets an authenticated user set up and fetch their business, then see the dashboard", async () => {
    await request(app).post("/auth/send-otp").send({ phone }).expect(200);
    const code = lastConsoleOtpForTests!.code;
    const verifyRes = await request(app).post("/auth/verify-otp").send({ phone, code }).expect(200);
    const token = verifyRes.body.data.token as string;

    await request(app).get("/business").set("Authorization", `Bearer ${token}`).expect(404);

    const businessPayload = {
      ownerName: "Kumar",
      businessName: "Kumar Textiles",
      category: "TEXTILE",
      city: "Coimbatore",
      runningSinceYear: 2015,
      monthlyVolumeApprox: 250000,
    };

    const putRes = await request(app)
      .put("/business")
      .set("Authorization", `Bearer ${token}`)
      .send(businessPayload)
      .expect(200);
    expect(putRes.body.data.businessName).toBe("Kumar Textiles");

    const dashboardRes = await request(app)
      .get("/dashboard")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(dashboardRes.body.data.businessName).toBe("Kumar Textiles");
    expect(dashboardRes.body.data.netPosition).toBe(0);
  });
});

describe("business + dashboard require auth", () => {
  it("rejects unauthenticated access", async () => {
    await request(app).get("/business").expect(401);
    await request(app).put("/business").send({}).expect(401);
    await request(app).get("/dashboard").expect(401);
  });
});

describe("health check", () => {
  it("returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
