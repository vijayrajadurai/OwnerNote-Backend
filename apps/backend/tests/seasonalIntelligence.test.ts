import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma";
import { createTestBusiness } from "./testHelpers";
import { getSeasonalInsights } from "../src/ai/seasonalIntelligence";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const TEST_PHONES = ["+919876593001", "+919876593002", "+919876593003"];

describe("seasonal intelligence", () => {
  afterAll(async () => {
    await prisma.debitTransaction.deleteMany({});
    await prisma.supplier.deleteMany({});
    await prisma.business.deleteMany({ where: { owner: { phone: { in: TEST_PHONES } } } });
    await prisma.user.deleteMany({ where: { phone: { in: TEST_PHONES } } });
    await prisma.$disconnect();
  });

  it("only surfaces events relevant to the business's category and within lead time", async () => {
    const businessId = await createTestBusiness(TEST_PHONES[0], "TEXTILE");
    const insights = await getSeasonalInsights(businessId, NOW);

    // Diwali (Nov 1, lead 45d) is ~37 days away from Sep 25 — included.
    expect(insights.some((i) => i.eventId === "diwali")).toBe(true);
    // Wedding season (Nov 15, lead 30d) is ~51 days away — too far out yet.
    expect(insights.some((i) => i.eventId === "wedding-season")).toBe(false);
    // Pongal is a TEXTILE event but many months away.
    expect(insights.some((i) => i.eventId === "pongal")).toBe(false);
  });

  it("does not surface events irrelevant to the business's category", async () => {
    const businessId = await createTestBusiness(TEST_PHONES[1], "PHARMACY");
    const insights = await getSeasonalInsights(businessId, NOW);
    expect(insights.some((i) => i.eventId === "diwali")).toBe(false);
    expect(insights.some((i) => i.eventId === "construction-season")).toBe(false);
  });

  it("marks the estimate as having no historical basis when there is no prior-year data", async () => {
    const businessId = await createTestBusiness(TEST_PHONES[2], "TEXTILE");
    const insights = await getSeasonalInsights(businessId, NOW);
    const diwali = insights.find((i) => i.eventId === "diwali");
    expect(diwali).toBeDefined();
    expect(diwali!.estimate.hasHistoricalBasis).toBe(false);
    expect(diwali!.estimate.lastYearAmount).toBeUndefined();
  });

  it("marks the estimate as historically grounded when last year's window has real transactions", async () => {
    const businessId = await createTestBusiness("+919876593004", "TEXTILE");
    const supplier = await prisma.supplier.create({ data: { businessId, name: "Diwali Stock Supplier" } });
    // Diwali this year lands ~Nov 1, 2026 -> last year's Diwali ~Nov 1, 2025.
    // The lead-time window is the 45 days before that.
    await prisma.debitTransaction.create({
      data: { businessId, supplierId: supplier.id, amount: 420000, createdAt: new Date("2025-10-15T00:00:00.000Z") },
    });

    const insights = await getSeasonalInsights(businessId, NOW);
    const diwali = insights.find((i) => i.eventId === "diwali");
    expect(diwali).toBeDefined();
    expect(diwali!.estimate.hasHistoricalBasis).toBe(true);
    expect(diwali!.estimate.lastYearAmount).toBe(420000);

    await prisma.debitTransaction.deleteMany({ where: { businessId } });
    await prisma.supplier.deleteMany({ where: { businessId } });
    await prisma.business.delete({ where: { id: businessId } });
    await prisma.user.deleteMany({ where: { phone: "+919876593004" } });
  });
});
