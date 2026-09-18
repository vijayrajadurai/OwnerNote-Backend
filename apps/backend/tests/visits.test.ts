import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { authenticateAsAdmin, authenticateAsSalesOfficer, createTestBusiness, createTestLead } from "./testHelpers";

const app = createApp();

const TEST_PHONES = [
  "+919876599001",
  "+919876599002",
  "+919876599003",
  "+919876599004",
  "+919876599005",
];

describe("Phase 6 — visits & follow-ups", () => {
  afterAll(async () => {
    await prisma.auditLog.deleteMany({});
    await prisma.leadAssignment.deleteMany({});
    await prisma.visitRecord.deleteMany({});
    await prisma.loanLead.deleteMany({});
    await prisma.salesOfficerProfile.deleteMany({});
    await prisma.business.deleteMany({ where: { owner: { phone: { in: TEST_PHONES } } } });
    await prisma.user.deleteMany({ where: { phone: { in: TEST_PHONES } } });
    await prisma.$disconnect();
  });

  it("lets an assigned officer create and update a visit, nudging lead status along the way", async () => {
    const { token: adminToken } = await authenticateAsAdmin(app, TEST_PHONES[0]);
    const officerA = await authenticateAsSalesOfficer(app, TEST_PHONES[1], "Ravi", "Chennai South");
    const officerB = await authenticateAsSalesOfficer(app, TEST_PHONES[2], "Suresh", "Chennai Central");
    const businessId = await createTestBusiness(TEST_PHONES[4], "TEXTILE");
    const lead = await createTestLead(businessId);

    await request(app)
      .post(`/leads/${lead.id}/assign`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ salesOfficerId: officerA.profileId })
      .expect(200);

    // Officer B (unassigned) cannot create a visit for this lead.
    await request(app)
      .post(`/leads/${lead.id}/visits`)
      .set("Authorization", `Bearer ${officerB.token}`)
      .send({ outcome: "SCHEDULED" })
      .expect(404);

    // Admin cannot create a visit (that's an FO action).
    await request(app)
      .post(`/leads/${lead.id}/visits`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ outcome: "SCHEDULED" })
      .expect(403);

    const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const createRes = await request(app)
      .post(`/leads/${lead.id}/visits`)
      .set("Authorization", `Bearer ${officerA.token}`)
      .send({ outcome: "SCHEDULED", scheduledAt })
      .expect(201);
    const visitId = createRes.body.data.id;

    const leadAfterSchedule = await prisma.loanLead.findUnique({ where: { id: lead.id } });
    expect(leadAfterSchedule!.status).toBe("VISIT_SCHEDULED");

    const nextFollowUpAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const updateRes = await request(app)
      .put(`/visits/${visitId}`)
      .set("Authorization", `Bearer ${officerA.token}`)
      .send({
        outcome: "VISITED",
        visitedAt: new Date().toISOString(),
        notes: "Needs working capital for upcoming stock purchase.",
        nextFollowUpAt,
      })
      .expect(200);
    expect(updateRes.body.data.outcome).toBe("VISITED");
    expect(updateRes.body.data.notes).toContain("working capital");

    const leadAfterVisit = await prisma.loanLead.findUnique({ where: { id: lead.id } });
    expect(leadAfterVisit!.status).toBe("VISITED");

    // Visible to both the assigned officer and admin; not to officer B.
    const listForOfficerA = await request(app)
      .get(`/leads/${lead.id}/visits`)
      .set("Authorization", `Bearer ${officerA.token}`)
      .expect(200);
    expect(listForOfficerA.body.data).toHaveLength(1);

    await request(app).get(`/leads/${lead.id}/visits`).set("Authorization", `Bearer ${officerB.token}`).expect(404);

    const listForAdmin = await request(app)
      .get(`/leads/${lead.id}/visits`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(listForAdmin.body.data).toHaveLength(1);
  });

  it("surfaces upcoming follow-ups scoped to the officer, and unscoped for admin", async () => {
    const { token: adminToken } = await authenticateAsAdmin(app, "+919876599100");
    const officerA = await authenticateAsSalesOfficer(app, "+919876599101", "Ravi", "Chennai South");
    const officerB = await authenticateAsSalesOfficer(app, "+919876599102", "Suresh", "Chennai Central");
    const businessId = await createTestBusiness("+919876599103", "TEXTILE");
    const lead = await createTestLead(businessId, { businessName: "ABC Textiles" });

    await request(app)
      .post(`/leads/${lead.id}/assign`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ salesOfficerId: officerA.profileId })
      .expect(200);

    const nextFollowUpAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    await request(app)
      .post(`/leads/${lead.id}/visits`)
      .set("Authorization", `Bearer ${officerA.token}`)
      .send({ outcome: "FOLLOW_UP_REQUIRED", nextFollowUpAt })
      .expect(201);

    const officerAFollowUps = await request(app)
      .get("/visits/follow-ups")
      .set("Authorization", `Bearer ${officerA.token}`)
      .expect(200);
    expect(officerAFollowUps.body.data).toHaveLength(1);
    expect(officerAFollowUps.body.data[0].lead.businessName).toBe("ABC Textiles");

    const officerBFollowUps = await request(app)
      .get("/visits/follow-ups")
      .set("Authorization", `Bearer ${officerB.token}`)
      .expect(200);
    expect(officerBFollowUps.body.data).toHaveLength(0);

    const adminFollowUps = await request(app)
      .get("/visits/follow-ups")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(adminFollowUps.body.data.length).toBeGreaterThanOrEqual(1);

    await prisma.auditLog.deleteMany({});
    await prisma.leadAssignment.deleteMany({ where: { leadId: lead.id } });
    await prisma.visitRecord.deleteMany({ where: { leadId: lead.id } });
    await prisma.loanLead.deleteMany({ where: { id: lead.id } });
    await prisma.salesOfficerProfile.deleteMany({ where: { id: { in: [officerA.profileId, officerB.profileId] } } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.user.deleteMany({
      where: { phone: { in: ["+919876599100", "+919876599101", "+919876599102", "+919876599103"] } },
    });
  });
});
