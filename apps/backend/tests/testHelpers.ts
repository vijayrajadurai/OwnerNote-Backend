import type { Express } from "express";
import request from "supertest";
import { lastConsoleOtpForTests } from "../src/modules/auth/otp.provider";
import { prisma } from "../src/db/prisma";
import type { BusinessCategory } from "@prisma/client";

export async function authenticate(app: Express, phone: string): Promise<string> {
  await request(app).post("/auth/send-otp").send({ phone }).expect(200);
  const code = lastConsoleOtpForTests!.code;
  const res = await request(app).post("/auth/verify-otp").send({ phone, code }).expect(200);
  return res.body.data.token as string;
}

export async function setUpBusiness(app: Express, token: string, category: BusinessCategory = "GROCERY"): Promise<void> {
  await request(app)
    .put("/business")
    .set("Authorization", `Bearer ${token}`)
    .send({
      ownerName: "Test Owner",
      businessName: "Test Shop",
      category,
      city: "Chennai",
    })
    .expect(200);
}

/** Creates a user + business directly via Prisma, bypassing HTTP — for tests that only need a businessId. */
export async function createTestBusiness(phone: string, category: BusinessCategory = "GROCERY"): Promise<string> {
  const user = await prisma.user.create({ data: { phone } });
  const business = await prisma.business.create({
    data: {
      ownerUserId: user.id,
      ownerName: "Test Owner",
      businessName: "Test Shop",
      category,
      city: "Chennai",
    },
  });
  return business.id;
}

/** Creates an ADMIN user row directly, then logs in through the normal OTP flow. */
export async function authenticateAsAdmin(app: Express, phone: string): Promise<{ token: string; userId: string }> {
  const user = await prisma.user.create({ data: { phone, role: "ADMIN" } });
  const token = await authenticate(app, phone);
  return { token, userId: user.id };
}

/** Creates a SALES_OFFICER user + profile directly, then logs in through the normal OTP flow. */
export async function authenticateAsSalesOfficer(
  app: Express,
  phone: string,
  name: string,
  territory?: string,
): Promise<{ token: string; userId: string; profileId: string }> {
  const user = await prisma.user.create({ data: { phone, role: "SALES_OFFICER" } });
  const profile = await prisma.salesOfficerProfile.create({ data: { userId: user.id, name, territory } });
  const token = await authenticate(app, phone);
  return { token, userId: user.id, profileId: profile.id };
}

/** Creates a LoanLead directly via Prisma — bypasses the Phase 5 funding flow for tests that only need a lead to exist. */
export async function createTestLead(
  businessId: string,
  overrides: Partial<{
    ownerName: string;
    businessName: string;
    phone: string;
    businessCategory: BusinessCategory;
    city: string;
    leadScore: number;
    fundingReason: string;
    aiDetectedReason: string;
  }> = {},
) {
  return prisma.loanLead.create({
    data: {
      businessId,
      ownerId: (await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).ownerUserId,
      ownerName: overrides.ownerName ?? "Kumar",
      businessName: overrides.businessName ?? "Kumar Textiles",
      phone: overrides.phone ?? "+919876500000",
      businessCategory: overrides.businessCategory ?? "TEXTILE",
      city: overrides.city ?? "Chennai",
      fundingReason: overrides.fundingReason ?? "Working capital gap",
      aiDetectedReason: overrides.aiDetectedReason ?? "Expected payments exceed expected collections by ₹1,00,000.",
      leadScore: overrides.leadScore ?? 70,
      leadScoreExplanation: { total: overrides.leadScore ?? 70, signals: [] },
      userIntent: "TALK_TO_SOMEONE",
      status: "NEW",
      source: "FUNDING_OPPORTUNITY",
    },
  });
}
