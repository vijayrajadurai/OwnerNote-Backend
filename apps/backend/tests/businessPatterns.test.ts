import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma";
import { createTestBusiness } from "./testHelpers";
import { getBusinessPatterns } from "../src/ai/businessPatterns";

const NOW = new Date("2026-09-11T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const TEST_PHONES = [
  "+919876591001",
  "+919876591002",
  "+919876591003",
  "+919876591004",
  "+919876591005",
];

describe("business patterns", () => {
  afterAll(async () => {
    await prisma.payment.deleteMany({});
    await prisma.creditTransaction.deleteMany({});
    await prisma.debitTransaction.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.supplier.deleteMany({});
    await prisma.business.deleteMany({ where: { owner: { phone: { in: TEST_PHONES } } } });
    await prisma.user.deleteMany({ where: { phone: { in: TEST_PHONES } } });
    await prisma.$disconnect();
  });

  it("does not flag a supplier with only 2 transactions as recurring", async () => {
    const businessId = await createTestBusiness("+919876591001", "HARDWARE");
    const supplier = await prisma.supplier.create({ data: { businessId, name: "TwoTimeSupplier" } });
    await prisma.debitTransaction.create({
      data: { businessId, supplierId: supplier.id, amount: 1000, createdAt: daysAgo(10) },
    });
    await prisma.debitTransaction.create({
      data: { businessId, supplierId: supplier.id, amount: 1000, createdAt: daysAgo(5) },
    });

    const patterns = await getBusinessPatterns(businessId, NOW);
    expect(patterns.some((p) => p.type === "RECURRING_SUPPLIER")).toBe(false);
  });

  it("flags a supplier with 3+ transactions as recurring, with the correct average", async () => {
    const businessId = await createTestBusiness("+919876591002", "HARDWARE");
    const supplier = await prisma.supplier.create({ data: { businessId, name: "Regular Supplier" } });
    for (const [amount, ago] of [[1000, 30], [2000, 20], [3000, 10]] as const) {
      await prisma.debitTransaction.create({ data: { businessId, supplierId: supplier.id, amount, createdAt: daysAgo(ago) } });
    }

    const patterns = await getBusinessPatterns(businessId, NOW);
    const pattern = patterns.find((p) => p.type === "RECURRING_SUPPLIER");
    expect(pattern).toBeDefined();
    expect(pattern!.message).toContain("Regular Supplier");
    expect(pattern!.message).toContain("2,000"); // average of 1000, 2000, 3000
  });

  it("flags an unusually large purchase relative to a supplier's own history", async () => {
    const businessId = await createTestBusiness("+919876591003", "HARDWARE");
    const supplier = await prisma.supplier.create({ data: { businessId, name: "Spike Supplier" } });
    for (const [amount, ago] of [[1000, 40], [1200, 30], [1100, 20], [10000, 1]] as const) {
      await prisma.debitTransaction.create({ data: { businessId, supplierId: supplier.id, amount, createdAt: daysAgo(ago) } });
    }

    const patterns = await getBusinessPatterns(businessId, NOW);
    const anomaly = patterns.find((p) => p.type === "LARGE_PURCHASE_ANOMALY");
    expect(anomaly).toBeDefined();
    expect(anomaly!.message).toContain("Spike Supplier");
  });

  it("flags increasing receivables when the last 30 days are meaningfully higher than the prior 30 days", async () => {
    const businessId = await createTestBusiness("+919876591004", "HARDWARE");
    const customer = await prisma.customer.create({ data: { businessId, name: "Growing Customer" } });
    // Previous 30-day window: 3 transactions totalling 3000
    for (const [amount, ago] of [[1000, 50], [1000, 45], [1000, 40]] as const) {
      await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount, createdAt: daysAgo(ago) } });
    }
    // Current 30-day window: total 6000 (100% up)
    for (const [amount, ago] of [[2000, 20], [2000, 10], [2000, 2]] as const) {
      await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount, createdAt: daysAgo(ago) } });
    }

    const patterns = await getBusinessPatterns(businessId, NOW);
    expect(patterns.some((p) => p.type === "INCREASING_RECEIVABLES")).toBe(true);
  });

  it("does not flag a trend without at least 3 prior-period data points", async () => {
    const businessId = await createTestBusiness("+919876591005", "HARDWARE");
    const customer = await prisma.customer.create({ data: { businessId, name: "Sparse Customer" } });
    await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount: 1000, createdAt: daysAgo(45) } });
    await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount: 5000, createdAt: daysAgo(5) } });

    const patterns = await getBusinessPatterns(businessId, NOW);
    expect(patterns.some((p) => p.type === "INCREASING_RECEIVABLES")).toBe(false);
  });
});
