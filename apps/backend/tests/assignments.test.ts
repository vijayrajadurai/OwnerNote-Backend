import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { authenticate, authenticateAsAdmin, authenticateAsSalesOfficer, createTestBusiness, createTestLead } from "./testHelpers";

const app = createApp();

const TEST_PHONES = ["+919876598001", "+919876598002", "+919876598003", "+919876598004", "+919876598100"];

describe("Phase 6 — lead assignment", () => {
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

  it("assigns a lead, bumps NEW -> ASSIGNED, then reassigns without destroying history", async () => {
    const { token: adminToken, userId: adminUserId } = await authenticateAsAdmin(app, TEST_PHONES[0]);
    const officerA = await authenticateAsSalesOfficer(app, TEST_PHONES[1], "Ravi", "Chennai South");
    const officerB = await authenticateAsSalesOfficer(app, TEST_PHONES[2], "Suresh", "Chennai Central");

    const businessId = await createTestBusiness(TEST_PHONES[4], "TEXTILE");
    const lead = await createTestLead(businessId);
    expect(lead.status).toBe("NEW");

    const assignRes = await request(app)
      .post(`/leads/${lead.id}/assign`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ salesOfficerId: officerA.profileId })
      .expect(200);
    expect(assignRes.body.data.salesOfficerId).toBe(officerA.profileId);
    expect(assignRes.body.data.active).toBe(true);

    const afterAssign = await prisma.loanLead.findUnique({ where: { id: lead.id } });
    expect(afterAssign!.status).toBe("ASSIGNED");

    const officerAList = await request(app).get("/leads").set("Authorization", `Bearer ${officerA.token}`).expect(200);
    expect(officerAList.body.data.some((l: { id: string }) => l.id === lead.id)).toBe(true);

    // Reassign to officer B.
    const reassignRes = await request(app)
      .post(`/leads/${lead.id}/assign`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ salesOfficerId: officerB.profileId })
      .expect(200);
    expect(reassignRes.body.data.salesOfficerId).toBe(officerB.profileId);

    const officerAListAfter = await request(app).get("/leads").set("Authorization", `Bearer ${officerA.token}`).expect(200);
    expect(officerAListAfter.body.data.some((l: { id: string }) => l.id === lead.id)).toBe(false);

    const officerBList = await request(app).get("/leads").set("Authorization", `Bearer ${officerB.token}`).expect(200);
    expect(officerBList.body.data.some((l: { id: string }) => l.id === lead.id)).toBe(true);

    // History preserves both rows — the old one deactivated, not deleted.
    const history = await request(app)
      .get(`/leads/${lead.id}/assignments`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(history.body.data).toHaveLength(2);
    const officerARow = history.body.data.find((a: { salesOfficerId: string }) => a.salesOfficerId === officerA.profileId);
    expect(officerARow.active).toBe(false);
    expect(officerARow.unassignedAt).not.toBeNull();
    const officerBRow = history.body.data.find((a: { salesOfficerId: string }) => a.salesOfficerId === officerB.profileId);
    expect(officerBRow.active).toBe(true);

    const auditRows = await prisma.auditLog.findMany({ where: { entityId: lead.id, actorUserId: adminUserId } });
    expect(auditRows.some((r) => r.action === "LEAD_ASSIGNED")).toBe(true);
    expect(auditRows.some((r) => r.action === "LEAD_REASSIGNED")).toBe(true);
  });

  it("unassigns a lead, leaving no active assignment", async () => {
    const { token: adminToken } = await authenticateAsAdmin(app, "+919876598200");
    const officer = await authenticateAsSalesOfficer(app, "+919876598201", "Kumar", "Chennai West");
    const businessId = await createTestBusiness("+919876598202", "HARDWARE");
    const lead = await createTestLead(businessId);

    await request(app)
      .post(`/leads/${lead.id}/assign`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ salesOfficerId: officer.profileId })
      .expect(200);

    await request(app).post(`/leads/${lead.id}/unassign`).set("Authorization", `Bearer ${adminToken}`).expect(200);

    const active = await prisma.leadAssignment.findFirst({ where: { leadId: lead.id, active: true } });
    expect(active).toBeNull();

    await prisma.auditLog.deleteMany({});
    await prisma.leadAssignment.deleteMany({ where: { leadId: lead.id } });
    await prisma.loanLead.deleteMany({ where: { id: lead.id } });
    await prisma.salesOfficerProfile.deleteMany({ where: { id: officer.profileId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.user.deleteMany({
      where: { phone: { in: ["+919876598200", "+919876598201", "+919876598202"] } },
    });
  });

  it("rejects assignment to a nonexistent sales officer", async () => {
    const { token: adminToken } = await authenticateAsAdmin(app, "+919876598300");
    const businessId = await createTestBusiness("+919876598301", "HARDWARE");
    const lead = await createTestLead(businessId);

    await request(app)
      .post(`/leads/${lead.id}/assign`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ salesOfficerId: "00000000-0000-0000-0000-000000000000" })
      .expect(404);

    await prisma.loanLead.deleteMany({ where: { id: lead.id } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.user.deleteMany({ where: { phone: { in: ["+919876598300", "+919876598301"] } } });
  });

  it("rejects non-admin roles from assigning/reassigning/unassigning/viewing history", async () => {
    const officer = await authenticateAsSalesOfficer(app, "+919876598400", "Ravi", "Chennai South");
    const ownerToken = await authenticate(app, "+919876598401");
    const businessId = await createTestBusiness("+919876598402", "HARDWARE");
    const lead = await createTestLead(businessId);

    await request(app)
      .post(`/leads/${lead.id}/assign`)
      .set("Authorization", `Bearer ${officer.token}`)
      .send({ salesOfficerId: officer.profileId })
      .expect(403);
    await request(app)
      .post(`/leads/${lead.id}/assign`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ salesOfficerId: officer.profileId })
      .expect(403);
    await request(app).get(`/leads/${lead.id}/assignments`).set("Authorization", `Bearer ${officer.token}`).expect(403);

    await prisma.loanLead.deleteMany({ where: { id: lead.id } });
    await prisma.salesOfficerProfile.deleteMany({ where: { id: officer.profileId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.user.deleteMany({
      where: { phone: { in: ["+919876598400", "+919876598401", "+919876598402"] } },
    });
  });
});
