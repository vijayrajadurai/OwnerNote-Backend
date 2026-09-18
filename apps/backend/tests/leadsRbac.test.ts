import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { authenticate, authenticateAsAdmin, authenticateAsSalesOfficer, createTestBusiness, createTestLead } from "./testHelpers";

const app = createApp();

const TEST_PHONES = [
  "+919876597001",
  "+919876597002",
  "+919876597003",
  "+919876597004",
  "+919876597100",
  "+919876597200",
  "+919876597201",
  "+919876597300",
];

describe("Phase 6 — leads RBAC", () => {
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

  it("rejects unauthenticated access", async () => {
    await request(app).get("/leads").expect(401);
    await request(app).get("/leads/some-id").expect(401);
    await request(app).put("/leads/some-id/status").send({ status: "QUALIFIED" }).expect(401);
  });

  it("rejects a plain OWNER role from accessing the leads API", async () => {
    const ownerToken = await authenticate(app, TEST_PHONES[0]);
    await request(app).get("/leads").set("Authorization", `Bearer ${ownerToken}`).expect(403);
  });

  it("lets ADMIN list and view any lead, and a sales officer only see leads assigned to them", async () => {
    const { token: adminToken } = await authenticateAsAdmin(app, TEST_PHONES[1]);
    const officerA = await authenticateAsSalesOfficer(app, TEST_PHONES[2], "Ravi", "Chennai South");
    const officerB = await authenticateAsSalesOfficer(app, TEST_PHONES[3], "Suresh", "Chennai Central");

    const businessId = await createTestBusiness("+919876597100", "TEXTILE");
    const lead = await createTestLead(businessId, { businessName: "ABC Textiles" });

    const admin = await prisma.user.findFirstOrThrow({ where: { phone: TEST_PHONES[1] } });
    await prisma.leadAssignment.create({
      data: { leadId: lead.id, salesOfficerId: officerA.profileId, assignedByUserId: admin.id },
    });

    const adminList = await request(app).get("/leads").set("Authorization", `Bearer ${adminToken}`).expect(200);
    expect(adminList.body.data.some((l: { id: string }) => l.id === lead.id)).toBe(true);

    const adminDetail = await request(app).get(`/leads/${lead.id}`).set("Authorization", `Bearer ${adminToken}`).expect(200);
    expect(adminDetail.body.data.businessName).toBe("ABC Textiles");

    const officerAList = await request(app).get("/leads").set("Authorization", `Bearer ${officerA.token}`).expect(200);
    expect(officerAList.body.data.some((l: { id: string }) => l.id === lead.id)).toBe(true);

    const officerBList = await request(app).get("/leads").set("Authorization", `Bearer ${officerB.token}`).expect(200);
    expect(officerBList.body.data.some((l: { id: string }) => l.id === lead.id)).toBe(false);

    // Officer B cannot reach the lead by id either — same 404, not 403, so
    // existence can't be inferred by probing.
    await request(app).get(`/leads/${lead.id}`).set("Authorization", `Bearer ${officerB.token}`).expect(404);
    await request(app)
      .put(`/leads/${lead.id}/status`)
      .set("Authorization", `Bearer ${officerB.token}`)
      .send({ status: "CONTACTED" })
      .expect(404);
  });

  it("validates status transitions server-side regardless of what the client sends", async () => {
    const { token: adminToken } = await authenticateAsAdmin(app, "+919876597200");
    const businessId = await createTestBusiness("+919876597201", "TEXTILE");
    const lead = await createTestLead(businessId);

    const invalid = await request(app)
      .put(`/leads/${lead.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "DISBURSED" });
    expect(invalid.status).toBe(400);

    const valid = await request(app)
      .put(`/leads/${lead.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "QUALIFIED" })
      .expect(200);
    expect(valid.body.data.status).toBe("QUALIFIED");
  });

  it("returns an empty list (not an error) for a sales officer with no profile set up", async () => {
    // Role must be set on the User row before login, since the JWT bakes
    // the role in at issuance — flipping it after the fact wouldn't affect
    // an already-issued token.
    await prisma.user.create({ data: { phone: "+919876597300", role: "SALES_OFFICER" } });
    const noProfileToken = await authenticate(app, "+919876597300");

    const res = await request(app).get("/leads").set("Authorization", `Bearer ${noProfileToken}`).expect(200);
    expect(res.body.data).toEqual([]);
  });
});
