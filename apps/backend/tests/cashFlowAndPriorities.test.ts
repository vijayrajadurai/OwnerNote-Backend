import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma";
import { createTestBusiness } from "./testHelpers";
import { getCashFlowSummary } from "../src/ai/cashFlowAnalyzer";
import { getDailyPriorities } from "../src/ai/dailyPriorities";

const NOW = new Date("2026-09-11T12:00:00.000Z");
const phone = "+919876590001";
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

let businessId: string;

describe("cash-flow + daily priorities", () => {
  beforeAll(async () => {
    businessId = await createTestBusiness(phone, "GROCERY");

    const kumar = await prisma.customer.create({ data: { businessId, name: "Kumar" } });
    const overdueCustomer = await prisma.customer.create({ data: { businessId, name: "OverdueCust" } });
    const abc = await prisma.supplier.create({ data: { businessId, name: "ABC Traders" } });
    const xyz = await prisma.supplier.create({ data: { businessId, name: "XYZ Traders" } });

    // Credit (receivables)
    await prisma.creditTransaction.create({
      data: { businessId, customerId: kumar.id, amount: 2000, paidAmount: 0, status: "PENDING", dueDate: days(3) },
    });
    await prisma.creditTransaction.create({
      data: { businessId, customerId: kumar.id, amount: 5000, paidAmount: 0, status: "PENDING", dueDate: days(20) },
    });
    await prisma.creditTransaction.create({
      data: {
        businessId,
        customerId: kumar.id,
        amount: 1000,
        paidAmount: 400,
        status: "PARTIALLY_PAID",
        dueDate: days(1),
      },
    });
    await prisma.creditTransaction.create({
      data: {
        businessId,
        customerId: overdueCustomer.id,
        amount: 1500,
        paidAmount: 0,
        status: "PENDING",
        dueDate: days(-1),
      },
    });

    // Debit (payables)
    await prisma.debitTransaction.create({
      data: { businessId, supplierId: abc.id, amount: 12000, paidAmount: 0, status: "PENDING", dueDate: days(2) },
    });
    await prisma.debitTransaction.create({
      data: { businessId, supplierId: xyz.id, amount: 3000, paidAmount: 3000, status: "PAID", dueDate: days(5) },
    });
    await prisma.debitTransaction.create({
      data: { businessId, supplierId: xyz.id, amount: 8000, paidAmount: 0, status: "PENDING", dueDate: days(25) },
    });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({});
    await prisma.creditTransaction.deleteMany({});
    await prisma.debitTransaction.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.supplier.deleteMany({});
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.user.deleteMany({ where: { phone } });
    await prisma.$disconnect();
  });

  it("computes total and pending receivables/payables from stored transactions", async () => {
    const summary = await getCashFlowSummary(businessId, NOW);
    expect(summary.totalReceivables).toBe(9500);
    expect(summary.totalPayables).toBe(23000);
    expect(summary.pendingReceivables).toBe(9100);
    expect(summary.pendingPayables).toBe(20000);
    expect(summary.netPosition).toBe(9100 - 20000);
  });

  it("computes 7-day and 30-day expected collections/payments windows", async () => {
    const summary = await getCashFlowSummary(businessId, NOW);
    expect(summary.next7Days.expectedCollections).toBe(4100);
    expect(summary.next7Days.expectedPayments).toBe(12000);
    expect(summary.next7Days.potentialGap).toBe(7900);

    expect(summary.next30Days.expectedCollections).toBe(9100);
    expect(summary.next30Days.expectedPayments).toBe(20000);
    expect(summary.next30Days.potentialGap).toBe(10900);
  });

  it("ranks overdue collections highest in daily priorities", async () => {
    const priorities = await getDailyPriorities(businessId, NOW);
    expect(priorities[0].kind).toBe("COLLECTION_DUE");
    expect(priorities[0].severity).toBe("HIGH");
    expect(priorities[0].message).toContain("OverdueCust");
    expect(priorities[0].message).toContain("overdue");
  });

  it("excludes items due beyond the 7-day lookahead", async () => {
    const priorities = await getDailyPriorities(businessId, NOW);
    const messages = priorities.map((p) => p.message).join(" | ");
    expect(messages).not.toContain("5,000"); // due in 20 days
    expect(messages).not.toContain("8,000"); // due in 25 days
  });

  it("includes a cash-pressure priority when 30-day pressure exceeds 7-day pressure", async () => {
    const priorities = await getDailyPriorities(businessId, NOW);
    expect(priorities.some((p) => p.kind === "CASH_PRESSURE")).toBe(true);
  });
});
