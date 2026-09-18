import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { authenticate, authenticateAsAdmin, authenticateAsSalesOfficer, createTestBusiness } from "./testHelpers";

const app = createApp();

const TEST_PHONES = [
  "+919876600001",
  "+919876600002",
  "+919876600003",
  "+919876600004",
  "+919876600100",
  "+919876600101",
  "+919876600200",
  "+919876600201",
  "+919876600202",
  "+919876600300",
  "+919876600301",
];

async function createLeadWithOpportunity(
  businessId: string,
  opts: { type: "SEASONAL_STOCK" | "WORKING_CAPITAL" | "SUPPLIER_PAYMENT"; status: string; leadScore: number; dedupeKey: string },
) {
  const opportunity = await prisma.fundingOpportunity.create({
    data: {
      businessId,
      type: opts.type,
      dedupeKey: opts.dedupeKey,
      title: "Test opportunity",
      explanation: "Test explanation",
      urgency: "MEDIUM",
      confidence: 0.6,
      signalScore: 50,
      sourceSignals: [],
      status: "CONVERTED_TO_LEAD",
    },
  });

  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

  return prisma.loanLead.create({
    data: {
      businessId,
      ownerId: business.ownerUserId,
      opportunityId: opportunity.id,
      ownerName: "Kumar",
      businessName: "Kumar Textiles",
      phone: "+919876500000",
      businessCategory: "TEXTILE",
      city: "Chennai",
      fundingReason: "Test",
      aiDetectedReason: "Test",
      leadScore: opts.leadScore,
      leadScoreExplanation: { total: opts.leadScore, signals: [] },
      userIntent: "TALK_TO_SOMEONE",
      status: opts.status as never,
      source: "FUNDING_OPPORTUNITY",
    },
  });
}

describe("Phase 6 — admin analytics & sales officer management", () => {
  afterAll(async () => {
    await prisma.auditLog.deleteMany({});
    await prisma.leadAssignment.deleteMany({});
    await prisma.visitRecord.deleteMany({});
    await prisma.loanLead.deleteMany({});
    await prisma.fundingOpportunity.deleteMany({});
    await prisma.salesOfficerProfile.deleteMany({});
    await prisma.business.deleteMany({ where: { owner: { phone: { in: TEST_PHONES } } } });
    await prisma.user.deleteMany({ where: { phone: { in: TEST_PHONES } } });
    await prisma.$disconnect();
  });

  it("rejects non-admin roles from every admin endpoint", async () => {
    const officer = await authenticateAsSalesOfficer(app, TEST_PHONES[0], "Ravi");
    const ownerToken = await authenticate(app, TEST_PHONES[1]);

    for (const token of [officer.token, ownerToken]) {
      await request(app).get("/admin/sales-officers").set("Authorization", `Bearer ${token}`).expect(403);
      await request(app).get("/admin/analytics").set("Authorization", `Bearer ${token}`).expect(403);
      await request(app).get("/admin/audit-log").set("Authorization", `Bearer ${token}`).expect(403);
    }
  });

  it("creates sales officers, reading them back from the database rather than any hardcoded list", async () => {
    const { token: adminToken } = await authenticateAsAdmin(app, TEST_PHONES[2]);

    const createRes = await request(app)
      .post("/admin/sales-officers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ phone: TEST_PHONES[3], name: "Ravi", territory: "Chennai South" })
      .expect(201);
    expect(createRes.body.data.name).toBe("Ravi");

    // A second attempt with the same phone conflicts rather than duplicating.
    await request(app)
      .post("/admin/sales-officers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ phone: TEST_PHONES[3], name: "Ravi Again", territory: "Chennai South" })
      .expect(409);

    const list = await request(app).get("/admin/sales-officers").set("Authorization", `Bearer ${adminToken}`).expect(200);
    expect(list.body.data.some((o: { name: string }) => o.name === "Ravi")).toBe(true);
  });

  it("computes pipeline analytics and lead-quality metrics from real records (measured as a delta over the baseline)", async () => {
    const { token: adminToken } = await authenticateAsAdmin(app, "+919876600100");
    const businessId = await createTestBusiness("+919876600101", "TEXTILE");

    const baseline = await request(app).get("/admin/analytics").set("Authorization", `Bearer ${adminToken}`).expect(200);

    await createLeadWithOpportunity(businessId, { type: "SEASONAL_STOCK", status: "NEW", leadScore: 40, dedupeKey: "d1" });
    await createLeadWithOpportunity(businessId, { type: "WORKING_CAPITAL", status: "ASSIGNED", leadScore: 50, dedupeKey: "d2" });
    await createLeadWithOpportunity(businessId, { type: "WORKING_CAPITAL", status: "CONTACTED", leadScore: 60, dedupeKey: "d3" });
    await createLeadWithOpportunity(businessId, { type: "SUPPLIER_PAYMENT", status: "VISITED", leadScore: 85, dedupeKey: "d4" });
    await createLeadWithOpportunity(businessId, { type: "SEASONAL_STOCK", status: "DISBURSED", leadScore: 90, dedupeKey: "d5" });

    const after = await request(app).get("/admin/analytics").set("Authorization", `Bearer ${adminToken}`).expect(200);

    const totalLeadsDelta = after.body.data.overview.totalLeads - baseline.body.data.overview.totalLeads;
    expect(totalLeadsDelta).toBe(5);

    const newLeadsDelta = after.body.data.overview.newLeads - baseline.body.data.overview.newLeads;
    expect(newLeadsDelta).toBe(1);

    const contactedDelta = after.body.data.overview.contactedLeads - baseline.body.data.overview.contactedLeads;
    expect(contactedDelta).toBe(3); // CONTACTED, VISITED, DISBURSED

    const applicationsDelta = after.body.data.overview.applicationsStarted - baseline.body.data.overview.applicationsStarted;
    expect(applicationsDelta).toBe(1); // DISBURSED only

    const disbursementsDelta = after.body.data.overview.disbursements - baseline.body.data.overview.disbursements;
    expect(disbursementsDelta).toBe(1);

    const opportunitiesDelta =
      after.body.data.funnel.fundingOpportunitiesDetected - baseline.body.data.funnel.fundingOpportunitiesDetected;
    expect(opportunitiesDelta).toBe(5);

    const seasonalAttributionDelta =
      (after.body.data.fundingTypeAttribution.SEASONAL_STOCK ?? 0) -
      (baseline.body.data.fundingTypeAttribution.SEASONAL_STOCK ?? 0);
    expect(seasonalAttributionDelta).toBe(2);
    const workingCapitalAttributionDelta =
      (after.body.data.fundingTypeAttribution.WORKING_CAPITAL ?? 0) -
      (baseline.body.data.fundingTypeAttribution.WORKING_CAPITAL ?? 0);
    expect(workingCapitalAttributionDelta).toBe(2);
  });

  it("computes sales officer performance from leads ever assigned to them, including historical (reassigned-away) ones", async () => {
    const { token: adminToken, userId: adminUserId } = await authenticateAsAdmin(app, "+919876600200");
    const officer = await authenticateAsSalesOfficer(app, "+919876600201", "Kumar", "Chennai West");
    const businessId = await createTestBusiness("+919876600202", "TEXTILE");

    const leadA = await createLeadWithOpportunity(businessId, {
      type: "WORKING_CAPITAL",
      status: "CONTACTED",
      leadScore: 60,
      dedupeKey: "perf-a",
    });
    const leadB = await createLeadWithOpportunity(businessId, {
      type: "WORKING_CAPITAL",
      status: "DISBURSED",
      leadScore: 80,
      dedupeKey: "perf-b",
    });

    await prisma.leadAssignment.create({
      data: { leadId: leadA.id, salesOfficerId: officer.profileId, assignedByUserId: adminUserId },
    });
    // Assigned then unassigned — still counts toward "ever assigned" for performance history.
    await prisma.leadAssignment.create({
      data: {
        leadId: leadB.id,
        salesOfficerId: officer.profileId,
        assignedByUserId: adminUserId,
        active: false,
        unassignedAt: new Date(),
      },
    });

    const perf = await request(app)
      .get(`/admin/sales-officers/${officer.profileId}/performance`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(perf.body.data.assigned).toBe(2);
    expect(perf.body.data.contacted).toBe(2); // CONTACTED and DISBURSED both count as "contacted or later"
    expect(perf.body.data.disbursements).toBe(1);
    expect(perf.body.data.conversionRate).toBe(50); // 1/2 = 50%
  });

  it("paginates the audit log", async () => {
    const { token: adminToken, userId: adminUserId } = await authenticateAsAdmin(app, "+919876600300");
    const businessId = await createTestBusiness("+919876600301", "TEXTILE");
    const lead = await createLeadWithOpportunity(businessId, {
      type: "WORKING_CAPITAL",
      status: "NEW",
      leadScore: 50,
      dedupeKey: "audit-1",
    });

    await request(app)
      .put(`/leads/${lead.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "QUALIFIED" })
      .expect(200);

    const auditRes = await request(app)
      .get("/admin/audit-log")
      .query({ page: 1, limit: 5 })
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(auditRes.body.limit).toBe(5);
    expect(auditRes.body.data.length).toBeLessThanOrEqual(5);
    expect(auditRes.body.data.some((row: { entityId: string; actorUserId: string }) => row.entityId === lead.id && row.actorUserId === adminUserId)).toBe(
      true,
    );
  });
});
