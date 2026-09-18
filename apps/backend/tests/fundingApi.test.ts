import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { authenticate, setUpBusiness } from "./testHelpers";

const app = createApp();

const TEST_PHONES = [
  "+919876596001",
  "+919876596002",
  "+919876596003",
  "+919876596004",
  "+919876596005",
  "+919876596006",
];

function withAuth(token: string, req: request.Test): request.Test {
  return req.set("Authorization", `Bearer ${token}`);
}

async function setUpWorkingCapitalBusiness(phone: string) {
  const token = await authenticate(app, phone);
  await setUpBusiness(app, token, "OTHER");
  const business = await prisma.business.findFirst({ where: { owner: { phone } } });
  const businessId = business!.id;

  const customer = await prisma.customer.create({ data: { businessId, name: "Kumar" } });
  const supplier = await prisma.supplier.create({ data: { businessId, name: "Murugan Traders" } });

  const inDays = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);
  await prisma.debitTransaction.create({ data: { businessId, supplierId: supplier.id, amount: 150000, dueDate: inDays(5) } });
  await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount: 5000, dueDate: inDays(10) } });
  await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount: 5000, dueDate: inDays(15) } });
  await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount: 5000, dueDate: inDays(20) } });
  await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount: 3000, dueDate: inDays(60) } });

  return { token, businessId };
}

describe("Phase 5 funding API", () => {
  afterAll(async () => {
    await prisma.loanLead.deleteMany({});
    await prisma.fundingOpportunity.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.creditTransaction.deleteMany({});
    await prisma.debitTransaction.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.supplier.deleteMany({});
    await prisma.business.deleteMany({ where: { owner: { phone: { in: TEST_PHONES } } } });
    await prisma.user.deleteMany({ where: { phone: { in: TEST_PHONES } } });
    await prisma.$disconnect();
  });

  it("rejects unauthenticated access to every funding/lead endpoint", async () => {
    await request(app).get("/funding-opportunities").expect(401);
    await request(app).get("/funding-opportunities/some-id").expect(401);
    await request(app).post("/funding-opportunities/some-id/interested").expect(401);
    await request(app).post("/funding-opportunities/some-id/not-now").expect(401);
    await request(app).post("/funding-opportunities/some-id/create-lead").send({}).expect(401);
    await request(app).get("/loan-leads").expect(401);
  });

  it("Scenario F/G — detects an opportunity, and refreshing again does not duplicate it", async () => {
    const { token, businessId } = await setUpWorkingCapitalBusiness(TEST_PHONES[0]);

    const first = await withAuth(token, request(app).get("/funding-opportunities")).expect(200);
    expect(first.body.data.length).toBeGreaterThanOrEqual(1);
    const opportunity = first.body.data.find((o: { type: string }) => o.type === "WORKING_CAPITAL");
    expect(opportunity).toBeDefined();
    expect(opportunity.status).toBe("SHOWN");

    const second = await withAuth(token, request(app).get("/funding-opportunities")).expect(200);
    expect(second.body.data.length).toBe(first.body.data.length);
    expect(second.body.data.map((o: { id: string }) => o.id).sort()).toEqual(
      first.body.data.map((o: { id: string }) => o.id).sort(),
    );

    const rowCount = await prisma.fundingOpportunity.count({ where: { businessId } });
    expect(rowCount).toBe(first.body.data.length);
  });

  it("Scenario F — no loan lead is created when the user selects NOT_NOW", async () => {
    const { token } = await setUpWorkingCapitalBusiness(TEST_PHONES[1]);
    const list = await withAuth(token, request(app).get("/funding-opportunities")).expect(200);
    const opportunity = list.body.data[0];

    const notNow = await withAuth(token, request(app).post(`/funding-opportunities/${opportunity.id}/not-now`)).expect(200);
    expect(notNow.body.data.status).toBe("NOT_NOW");

    // Attempting to create a lead without having expressed interest must fail.
    const attempt = await withAuth(token, request(app).post(`/funding-opportunities/${opportunity.id}/create-lead`)).send({
      userIntent: "EXPLORE_OPTIONS",
    });
    expect(attempt.status).toBe(400);

    const leads = await withAuth(token, request(app).get("/loan-leads")).expect(200);
    expect(leads.body.data).toHaveLength(0);

    // A refresh immediately after NOT_NOW must not resurface the same opportunity.
    const refreshed = await withAuth(token, request(app).get("/funding-opportunities")).expect(200);
    expect(refreshed.body.data.some((o: { id: string }) => o.id === opportunity.id)).toBe(false);
  });

  it("resurfaces a NOT_NOW opportunity once the cooldown period has passed", async () => {
    const { token, businessId } = await setUpWorkingCapitalBusiness(TEST_PHONES[2]);
    const list = await withAuth(token, request(app).get("/funding-opportunities")).expect(200);
    const opportunity = list.body.data[0];

    await withAuth(token, request(app).post(`/funding-opportunities/${opportunity.id}/not-now`)).expect(200);

    // Simulate 20 days passing since the user said "not now" (cooldown is 14 days).
    await prisma.fundingOpportunity.update({
      where: { id: opportunity.id },
      data: { respondedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) },
    });

    const refreshed = await withAuth(token, request(app).get("/funding-opportunities")).expect(200);
    const resurfaced = refreshed.body.data.find((o: { id: string }) => o.id === opportunity.id);
    expect(resurfaced).toBeDefined();
    expect(resurfaced.status).toBe("SHOWN");

    const row = await prisma.fundingOpportunity.findUnique({ where: { id: opportunity.id } });
    expect(row!.businessId).toBe(businessId);
  });

  it("Scenario G — creates a fully attributed, scored lead only after explicit interest, and prevents duplicates", async () => {
    const { token, businessId } = await setUpWorkingCapitalBusiness(TEST_PHONES[3]);
    const list = await withAuth(token, request(app).get("/funding-opportunities")).expect(200);
    const opportunity = list.body.data.find((o: { type: string }) => o.type === "WORKING_CAPITAL");
    expect(opportunity).toBeDefined();

    // Cannot create a lead before expressing interest.
    const tooEarly = await withAuth(token, request(app).post(`/funding-opportunities/${opportunity.id}/create-lead`)).send({
      userIntent: "TALK_TO_SOMEONE",
    });
    expect(tooEarly.status).toBe(400);

    const interested = await withAuth(token, request(app).post(`/funding-opportunities/${opportunity.id}/interested`)).expect(
      200,
    );
    expect(interested.body.data.status).toBe("INTERESTED");

    const createRes = await withAuth(token, request(app).post(`/funding-opportunities/${opportunity.id}/create-lead`)).send({
      userIntent: "TALK_TO_SOMEONE",
      fundingRequirementMax: 200000,
      workingCapitalRequirement: 150000,
      preferredCallbackTime: "4 PM",
    });
    expect(createRes.status).toBe(201);
    const lead = createRes.body.data;

    // Full attribution chain: why this lead exists, tied back to the opportunity.
    expect(lead.businessId).toBe(businessId);
    expect(lead.opportunityId).toBe(opportunity.id);
    expect(lead.fundingReason).toBe(opportunity.title);
    expect(lead.aiDetectedReason).toBe(opportunity.explanation);
    expect(lead.userIntent).toBe("TALK_TO_SOMEONE");
    expect(lead.preferredCallbackTime).toBe("4 PM");
    expect(lead.leadScore).toBeGreaterThan(0);
    expect(lead.leadScoreExplanation.total).toBe(lead.leadScore);
    expect(Array.isArray(lead.leadScoreExplanation.signals)).toBe(true);
    expect(lead.status).toBe("NEW");
    expect(lead.source).toBe("FUNDING_OPPORTUNITY");

    // The opportunity is now converted; re-fetching it reflects that.
    const oppAfter = await withAuth(token, request(app).get(`/funding-opportunities/${opportunity.id}`)).expect(200);
    expect(oppAfter.body.data.status).toBe("CONVERTED_TO_LEAD");

    // Duplicate create-lead calls are idempotent, not a second lead.
    const secondCreate = await withAuth(
      token,
      request(app).post(`/funding-opportunities/${opportunity.id}/create-lead`),
    ).send({ userIntent: "EXPLORE_OPTIONS" });
    expect(secondCreate.status).toBe(201);
    expect(secondCreate.body.data.id).toBe(lead.id);
    const leadCount = await prisma.loanLead.count({ where: { businessId } });
    expect(leadCount).toBe(1);

    const myLeads = await withAuth(token, request(app).get("/loan-leads")).expect(200);
    expect(myLeads.body.data.map((l: { id: string }) => l.id)).toContain(lead.id);
  });

  it("scopes funding opportunities to the requesting business — cannot view or act on another business's opportunity", async () => {
    const businessA = await setUpWorkingCapitalBusiness(TEST_PHONES[4]);
    const tokenB = await authenticate(app, TEST_PHONES[5]);
    await setUpBusiness(app, tokenB, "OTHER");

    const listA = await withAuth(businessA.token, request(app).get("/funding-opportunities")).expect(200);
    const opportunityId = listA.body.data[0].id;

    await withAuth(tokenB, request(app).get(`/funding-opportunities/${opportunityId}`)).expect(404);
    await withAuth(tokenB, request(app).post(`/funding-opportunities/${opportunityId}/interested`)).expect(404);
  });
});
