import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma";
import { createTestBusiness } from "./testHelpers";
import { compareTrailingPeriods, getHistoricalWindowTotal } from "../src/ai/historicalIntelligence";

const NOW = new Date("2026-09-11T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const TEST_PHONES = ["+919876592001", "+919876592002", "+919876592003", "+919876592004"];

describe("historical intelligence — never fabricates numbers", () => {
  afterAll(async () => {
    await prisma.businessEvent.deleteMany({});
    await prisma.debitTransaction.deleteMany({});
    await prisma.supplier.deleteMany({});
    await prisma.business.deleteMany({ where: { owner: { phone: { in: TEST_PHONES } } } });
    await prisma.user.deleteMany({ where: { phone: { in: TEST_PHONES } } });
    await prisma.$disconnect();
  });

  it("compareTrailingPeriods reports no data honestly for a brand-new business", async () => {
    const businessId = await createTestBusiness(TEST_PHONES[0]);
    const result = await compareTrailingPeriods(businessId, NOW, 30);
    expect(result.hasData).toBe(false);
    expect(result.currentPeriodTotal).toBeUndefined();
    expect(result.previousPeriodTotal).toBeUndefined();
    expect(result.message).toMatch(/not enough historical data/i);
  });

  it("compareTrailingPeriods computes a real percentage change once both periods have data", async () => {
    const businessId = await createTestBusiness(TEST_PHONES[1]);
    const supplier = await prisma.supplier.create({ data: { businessId, name: "S" } });
    // Previous 30-day window: 10,000
    await prisma.debitTransaction.create({ data: { businessId, supplierId: supplier.id, amount: 10000, createdAt: daysAgo(45) } });
    // Current 30-day window: 15,000 (+50%)
    await prisma.debitTransaction.create({ data: { businessId, supplierId: supplier.id, amount: 15000, createdAt: daysAgo(10) } });

    const result = await compareTrailingPeriods(businessId, NOW, 30);
    expect(result.hasData).toBe(true);
    expect(result.previousPeriodTotal).toBe(10000);
    expect(result.currentPeriodTotal).toBe(15000);
    expect(result.changePercent).toBe(50);
    expect(result.message).toContain("up");
  });

  it("getHistoricalWindowTotal returns the exact no-data message when nothing exists in the window", async () => {
    const businessId = await createTestBusiness(TEST_PHONES[2]);
    const result = await getHistoricalWindowTotal(businessId, daysAgo(400), daysAgo(370));
    expect(result.hasData).toBe(false);
    expect(result.previousPeriodTotal).toBeUndefined();
    expect(result.message).toContain("Previous-year business data");
  });

  it("getHistoricalWindowTotal picks up real data recorded in that window, including imported BusinessEvent rows", async () => {
    const businessId = await createTestBusiness(TEST_PHONES[3]);
    const supplier = await prisma.supplier.create({ data: { businessId, name: "S" } });
    await prisma.debitTransaction.create({
      data: { businessId, supplierId: supplier.id, amount: 20000, createdAt: daysAgo(380) },
    });
    await prisma.businessEvent.create({
      data: {
        businessId,
        eventType: "STOCK_PURCHASE",
        amount: 5000,
        occurredAt: daysAgo(375),
        source: "CSV_IMPORT",
      },
    });

    const result = await getHistoricalWindowTotal(businessId, daysAgo(400), daysAgo(370));
    expect(result.hasData).toBe(true);
    expect(result.previousPeriodTotal).toBe(25000);
  });
});
