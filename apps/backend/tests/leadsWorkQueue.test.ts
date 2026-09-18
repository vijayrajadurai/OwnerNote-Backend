import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { authenticate, authenticateAsAdmin, authenticateAsSalesOfficer, createTestBusiness } from "./testHelpers";

const app = createApp();

const TEST_PHONES = [
  "+919876601001",
  "+919876601002",
  "+919876601003",
  "+919876601004",
  "+919876601005",
  "+919876601006",
  "+919876601007",
  "+919876601008",
  "+919876601009",
];

async function createLead(
  businessId: string,
  overrides: Partial<{
    businessName: string;
    city: string;
    leadScore: number;
    status: string;
    preferredCallbackTime: string | null;
  }> = {},
) {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  return prisma.loanLead.create({
    data: {
      businessId,
      ownerId: business.ownerUserId,
      ownerName: "Kumar",
      businessName: overrides.businessName ?? "Kumar Textiles",
      phone: "+919876500000",
      businessCategory: "TEXTILE",
      city: overrides.city ?? "Chennai",
      fundingReason: "Test",
      aiDetectedReason: "Test",
      leadScore: overrides.leadScore ?? 50,
      leadScoreExplanation: { total: overrides.leadScore ?? 50, signals: [] },
      userIntent: "TALK_TO_SOMEONE",
      status: (overrides.status ?? "NEW") as never,
      preferredCallbackTime: overrides.preferredCallbackTime ?? null,
      source: "FUNDING_OPPORTUNITY",
    },
  });
}

async function createOpportunity(businessId: string, urgency: "LOW" | "MEDIUM" | "HIGH", expiresAt: Date | null, dedupeKey: string) {
  return prisma.fundingOpportunity.create({
    data: {
      businessId,
      type: "WORKING_CAPITAL",
      dedupeKey,
      title: "Test opportunity",
      explanation: "Test explanation",
      urgency,
      confidence: 0.6,
      signalScore: 50,
      sourceSignals: [],
      status: "CONVERTED_TO_LEAD",
      expiresAt,
    },
  });
}

describe("Phase 6 — lead list sorting & FO work queue", () => {
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

  it("sorts the lead list server-side by the requested field and direction", async () => {
    const { token: adminToken } = await authenticateAsAdmin(app, TEST_PHONES[0]);
    const businessId = await createTestBusiness(TEST_PHONES[1], "TEXTILE");

    const leadA = await createLead(businessId, { businessName: "Zebra Traders", city: "Alpha City" });
    const leadB = await createLead(businessId, { businessName: "Alpha Traders", city: "Zeta City" });

    const ascRes = await request(app)
      .get("/leads")
      .query({ sortBy: "city", sortDir: "asc", search: "Traders" })
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const ids = ascRes.body.data.map((l: { id: string }) => l.id);
    expect(ids.indexOf(leadA.id)).toBeLessThan(ids.indexOf(leadB.id));

    const descRes = await request(app)
      .get("/leads")
      .query({ sortBy: "city", sortDir: "desc", search: "Traders" })
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const descIds = descRes.body.data.map((l: { id: string }) => l.id);
    expect(descIds.indexOf(leadB.id)).toBeLessThan(descIds.indexOf(leadA.id));
  });

  it("prioritizes the FO work queue by high intent, urgency, callback preference, and expiry, and excludes closed leads", async () => {
    const { token: adminToken, userId: adminUserId } = await authenticateAsAdmin(app, TEST_PHONES[2]);
    const officer = await authenticateAsSalesOfficer(app, TEST_PHONES[3], "Ravi", "Chennai South");
    const businessId = await createTestBusiness("+919876601005", "TEXTILE");

    // Low score, no opportunity, no callback preference — lowest priority.
    const lowPriorityLead = await createLead(businessId, { businessName: "Low Priority", leadScore: 40 });

    // High intent (score >= 70), HIGH urgency opportunity expiring soon, explicit callback preference.
    const urgentOpportunity = await createOpportunity(
      businessId,
      "HIGH",
      new Date(Date.now() + 24 * 60 * 60 * 1000),
      "wq-urgent",
    );
    const highPriorityLead = await prisma.loanLead.update({
      where: { id: (await createLead(businessId, { businessName: "High Priority", leadScore: 85, preferredCallbackTime: "Evenings" })).id },
      data: { opportunityId: urgentOpportunity.id },
    });

    // A closed lead that must never appear in the queue.
    const closedLead = await createLead(businessId, { businessName: "Already Disbursed", leadScore: 95, status: "DISBURSED" });

    for (const lead of [lowPriorityLead, highPriorityLead, closedLead]) {
      await prisma.leadAssignment.create({
        data: { leadId: lead.id, salesOfficerId: officer.profileId, assignedByUserId: adminUserId },
      });
    }

    const queueRes = await request(app)
      .get("/leads/work-queue")
      .set("Authorization", `Bearer ${officer.token}`)
      .expect(200);

    const queueIds = queueRes.body.data.map((l: { id: string }) => l.id);
    expect(queueIds).not.toContain(closedLead.id);
    expect(queueIds).toEqual([highPriorityLead.id, lowPriorityLead.id]);

    // Admin never fetches a work queue — only the assigned officer has one.
    const adminAttempt = await request(app)
      .get("/leads/work-queue")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(adminAttempt.body.data).toEqual([]);
  });

  it("computes the FO dashboard summary from real assignments, visits, and status-change audit history", async () => {
    const officer = await authenticateAsSalesOfficer(app, TEST_PHONES[6], "Priya", "Bengaluru");
    const businessId = await createTestBusiness(TEST_PHONES[7], "TEXTILE");

    const newLead = await createLead(businessId, { businessName: "New Lead Co", leadScore: 50, status: "NEW" });
    const highIntentLead = await createLead(businessId, { businessName: "High Intent Co", leadScore: 85, status: "ASSIGNED" });

    const admin = await prisma.user.findFirstOrThrow({ where: { phone: TEST_PHONES[2] } });
    for (const lead of [newLead, highIntentLead]) {
      await prisma.leadAssignment.create({
        data: { leadId: lead.id, salesOfficerId: officer.profileId, assignedByUserId: admin.id },
      });
    }

    // A call today: moving the high-intent lead to CONTACTED leaves an audit trail.
    await request(app)
      .put(`/leads/${highIntentLead.id}/status`)
      .set("Authorization", `Bearer ${officer.token}`)
      .send({ status: "CONTACTED" })
      .expect(200);

    // A visit scheduled for today, and a separate follow-up commitment.
    await prisma.visitRecord.create({
      data: { leadId: newLead.id, salesOfficerId: officer.profileId, scheduledAt: new Date(), outcome: "SCHEDULED" },
    });
    await prisma.visitRecord.create({
      data: {
        leadId: highIntentLead.id,
        salesOfficerId: officer.profileId,
        outcome: "FOLLOW_UP_REQUIRED",
        nextFollowUpAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      },
    });

    const summaryRes = await request(app)
      .get("/leads/fo-summary")
      .set("Authorization", `Bearer ${officer.token}`)
      .expect(200);

    expect(summaryRes.body.data).toEqual({
      newLeads: 1,
      highIntentLeads: 1,
      todaysCalls: 1,
      todaysVisits: 1,
      upcomingFollowUps: 1,
    });
  });

  it("returns all zeros for a sales officer with no profile set up", async () => {
    await prisma.user.create({ data: { phone: TEST_PHONES[8], role: "SALES_OFFICER" } });
    const token = await authenticate(app, TEST_PHONES[8]);

    const summaryRes = await request(app).get("/leads/fo-summary").set("Authorization", `Bearer ${token}`).expect(200);
    expect(summaryRes.body.data).toEqual({ newLeads: 0, highIntentLeads: 0, todaysCalls: 0, todaysVisits: 0, upcomingFollowUps: 0 });
  });
});
