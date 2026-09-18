import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { authenticate, setUpBusiness } from "./testHelpers";

const app = createApp();
const phone = "+919876594001";
const NOW_ISO_DAY = new Date().toISOString().slice(0, 10);

let token: string;
let businessId: string;

function auth(req: request.Test) {
  return req.set("Authorization", `Bearer ${token}`);
}

describe("Phase 4 insights API", () => {
  beforeAll(async () => {
    token = await authenticate(app, phone);
    await setUpBusiness(app, token, "HARDWARE");
    const business = await prisma.business.findFirst({ where: { owner: { phone } } });
    businessId = business!.id;
  });

  afterAll(async () => {
    await prisma.aiInsight.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.creditTransaction.deleteMany({});
    await prisma.debitTransaction.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.supplier.deleteMany({});
    await prisma.business.deleteMany({});
    await prisma.otpChallenge.deleteMany({ where: { phone } });
    await prisma.user.deleteMany({ where: { phone } });
    await prisma.$disconnect();
  });

  it("rejects unauthenticated access to every Phase 4 endpoint", async () => {
    await request(app).get("/cashflow").expect(401);
    await request(app).get("/business-health").expect(401);
    await request(app).get("/priorities").expect(401);
    await request(app).get("/ai-insights").expect(401);
    await request(app).get("/seasonal-insights").expect(401);
    await request(app).get("/historical-insights").expect(401);
    await request(app).post("/ask-my-business").send({ question: "hi" }).expect(401);
  });

  it("returns STABLE health and an all-clear priority for a brand-new business with no transactions", async () => {
    const health = await auth(request(app).get("/business-health")).expect(200);
    expect(health.body.data.status).toBe("STABLE");

    const priorities = await auth(request(app).get("/priorities")).expect(200);
    expect(priorities.body.data).toHaveLength(1);
    expect(priorities.body.data[0].kind).toBe("ALL_CLEAR");
  });

  it("never reports historical numbers for a business with no prior transactions", async () => {
    const res = await auth(request(app).get("/historical-insights")).expect(200);
    expect(res.body.data.hasData).toBe(false);
    expect(res.body.data.currentPeriodTotal).toBeUndefined();
    expect(res.body.data.previousPeriodTotal).toBeUndefined();

    const ask = await auth(request(app).post("/ask-my-business")).send({
      question: "Last month compare panna business improve aacha?",
    });
    expect(ask.status).toBe(200);
    expect(ask.body.data.matchedIntent).toBe("MONTH_COMPARISON");
    expect(ask.body.data.answer).toMatch(/not enough historical data/i);
  });

  it("creates real cash pressure once payments outweigh collections, and surfaces it via cashflow/health/priorities/insights", async () => {
    const customer = await prisma.customer.create({ data: { businessId, name: "Kumar" } });
    const supplier = await prisma.supplier.create({ data: { businessId, name: "Murugan Traders" } });

    await prisma.creditTransaction.create({
      data: { businessId, customerId: customer.id, amount: 5000, dueDate: new Date(`${NOW_ISO_DAY}T00:00:00.000Z`) },
    });
    await prisma.debitTransaction.create({
      data: { businessId, supplierId: supplier.id, amount: 40000, dueDate: new Date(`${NOW_ISO_DAY}T00:00:00.000Z`) },
    });

    const cashflow = await auth(request(app).get("/cashflow")).expect(200);
    expect(cashflow.body.data.pendingReceivables).toBe(5000);
    expect(cashflow.body.data.pendingPayables).toBe(40000);
    expect(cashflow.body.data.next7Days.potentialGap).toBe(35000);

    const health = await auth(request(app).get("/business-health")).expect(200);
    expect(["WATCH", "PRESSURE", "HIGH_PRESSURE"]).toContain(health.body.data.status);

    const priorities = await auth(request(app).get("/priorities")).expect(200);
    expect(priorities.body.data.some((p: { kind: string }) => p.kind === "PAYMENT_DUE")).toBe(true);
    expect(priorities.body.data.some((p: { kind: string }) => p.kind === "COLLECTION_DUE")).toBe(true);

    const insights = await auth(request(app).get("/ai-insights")).expect(200);
    const businessHealthInsight = insights.body.data.find((i: { type: string }) => i.type === "BUSINESS_HEALTH");
    expect(businessHealthInsight).toBeDefined();
    expect(businessHealthInsight.severity).not.toBe("INFO");
  });

  it("updates the existing BUSINESS_HEALTH row in place across refreshes instead of duplicating it", async () => {
    const before = await auth(request(app).get("/ai-insights")).expect(200);
    const healthRowsBefore = before.body.data.filter((i: { type: string }) => i.type === "BUSINESS_HEALTH");
    expect(healthRowsBefore).toHaveLength(1);
    const healthId = healthRowsBefore[0].id;

    // Health text/severity already changed from STABLE -> pressure between
    // the earlier "brand-new business" test and now; refreshing again must
    // still be exactly one row with the same id, not a second one.
    const after = await auth(request(app).get("/ai-insights")).expect(200);
    const healthRowsAfter = after.body.data.filter((i: { type: string }) => i.type === "BUSINESS_HEALTH");
    expect(healthRowsAfter).toHaveLength(1);
    expect(healthRowsAfter[0].id).toBe(healthId);
  });

  it("dismissing an insight removes it from the default list on the next refresh", async () => {
    const insights = await auth(request(app).get("/ai-insights")).expect(200);
    const target = insights.body.data[0];
    expect(target).toBeDefined();

    await auth(request(app).post(`/ai-insights/${target.id}/dismiss`)).expect(200);

    const after = await auth(request(app).get("/ai-insights")).expect(200);
    expect(after.body.data.some((i: { id: string }) => i.id === target.id)).toBe(false);
  });

  it("marks an insight as read", async () => {
    const insights = await auth(request(app).get("/ai-insights")).expect(200);
    const target = insights.body.data[0];
    const res = await auth(request(app).post(`/ai-insights/${target.id}/read`)).expect(200);
    expect(res.body.data.readAt).not.toBeNull();
  });

  it("answers 'who should I collect from' using real pending customer balances", async () => {
    const res = await auth(request(app).post("/ask-my-business")).send({ question: "Yaar kitta cash collect pannanum?" });
    expect(res.status).toBe(200);
    expect(res.body.data.matchedIntent).toBe("WHO_TO_COLLECT");
    expect(res.body.data.answer).toContain("Kumar");
  });

  it("returns a low-confidence UNKNOWN answer for an unrelated question", async () => {
    const res = await auth(request(app).post("/ask-my-business")).send({ question: "What is the weather today" });
    expect(res.body.data.matchedIntent).toBe("UNKNOWN");
    expect(res.body.data.confidence).toBe(0);
  });
});
