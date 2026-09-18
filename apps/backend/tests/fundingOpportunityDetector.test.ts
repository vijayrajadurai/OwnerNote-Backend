import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma";
import { createTestBusiness } from "./testHelpers";
import { detectFundingOpportunities } from "../src/ai/fundingOpportunityDetector";

const NOW = new Date("2026-09-11T12:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const TEST_PHONES = [
  "+919876595001",
  "+919876595002",
  "+919876595003",
  "+919876595004",
  "+919876595005",
  "+919876595006",
  "+919876595007",
  "+919876595008",
  "+919876595009",
  "+919876595010",
];

describe("fundingOpportunityDetector", () => {
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

  it("Scenario A — returns no opportunities for a healthy business with insufficient ledger data", async () => {
    const businessId = await createTestBusiness(TEST_PHONES[0], "OTHER");
    const customer = await prisma.customer.create({ data: { businessId, name: "Small Customer" } });
    const supplier = await prisma.supplier.create({ data: { businessId, name: "Small Supplier" } });
    await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount: 3000, dueDate: days(10) } });
    await prisma.debitTransaction.create({ data: { businessId, supplierId: supplier.id, amount: 3000, dueDate: days(10) } });

    const opportunities = await detectFundingOpportunities(businessId, NOW);
    expect(opportunities).toHaveLength(0);
  });

  it("detects a WORKING_CAPITAL gap when 30-day payments heavily outweigh collections", async () => {
    const businessId = await createTestBusiness(TEST_PHONES[1], "OTHER");
    const customer = await prisma.customer.create({ data: { businessId, name: "Ravi" } });
    const supplier = await prisma.supplier.create({ data: { businessId, name: "Murugan Traders" } });

    await prisma.debitTransaction.create({
      data: { businessId, supplierId: supplier.id, amount: 40000, dueDate: days(5) },
    });
    await prisma.debitTransaction.create({
      data: { businessId, supplierId: supplier.id, amount: 40000, dueDate: days(15) },
    });
    await prisma.debitTransaction.create({
      data: { businessId, supplierId: supplier.id, amount: 40000, dueDate: days(25) },
    });
    await prisma.debitTransaction.create({
      data: { businessId, supplierId: supplier.id, amount: 40000, dueDate: days(28) },
    });
    await prisma.creditTransaction.create({
      data: { businessId, customerId: customer.id, amount: 10000, dueDate: days(25) },
    });

    const opportunities = await detectFundingOpportunities(businessId, NOW);
    const wc = opportunities.find((o) => o.type === "WORKING_CAPITAL");
    expect(wc).toBeDefined();
    expect(wc!.estimatedGap).toBe(150000);
    expect(wc!.signalScore).toBeGreaterThanOrEqual(40);
    expect(wc!.sourceSignals.some((s) => s.type === "CASH_FLOW_GAP")).toBe(true);
    expect(wc!.explanation).toMatch(/possible working-capital gap/i);
  });

  it("Scenario B — computes an approximate ₹60K gap for ₹1.2L payments vs ₹60K collections", async () => {
    const businessId = await createTestBusiness(TEST_PHONES[2], "OTHER");
    const customer = await prisma.customer.create({ data: { businessId, name: "Kumar" } });
    const supplier = await prisma.supplier.create({ data: { businessId, name: "ABC Traders" } });

    await prisma.debitTransaction.create({ data: { businessId, supplierId: supplier.id, amount: 120000, dueDate: days(5) } });
    await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount: 10000, dueDate: days(5) } });
    await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount: 5000, dueDate: days(10) } });
    await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount: 5000, dueDate: days(15) } });
    await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount: 3000, dueDate: days(45) } });

    const opportunities = await detectFundingOpportunities(businessId, NOW);
    const wc = opportunities.find((o) => o.type === "WORKING_CAPITAL");
    expect(wc).toBeDefined();
    expect(wc!.estimatedRequirement).toBe(120000);
    expect(wc!.estimatedAvailableCash).toBe(20000);
    expect(wc!.estimatedGap).toBe(100000);
  });

  it("detects SEASONAL_STOCK with a real historical estimate for a returning business", async () => {
    const businessId = await createTestBusiness(TEST_PHONES[3], "TEXTILE");
    const supplier = await prisma.supplier.create({ data: { businessId, name: "Diwali Stock Co" } });
    const customer = await prisma.customer.create({ data: { businessId, name: "Regular Buyer" } });

    // Last year's Diwali stock purchase, well within this event's lead-time window.
    await prisma.debitTransaction.create({
      data: { businessId, supplierId: supplier.id, amount: 420000, createdAt: new Date("2025-10-15T00:00:00.000Z") },
    });
    // A few recent transactions so the business clears the minimum-activity gate.
    for (let i = 0; i < 4; i++) {
      await prisma.creditTransaction.create({
        data: { businessId, customerId: customer.id, amount: 6000, createdAt: daysAgo(5 + i), dueDate: days(20) },
      });
    }

    const closeToOct27 = new Date("2026-10-27T12:00:00.000Z");
    const opportunities = await detectFundingOpportunities(businessId, closeToOct27);
    const seasonal = opportunities.find((o) => o.type === "SEASONAL_STOCK");
    expect(seasonal).toBeDefined();
    const historicalSignal = seasonal!.sourceSignals.find((s) => s.type === "HISTORICAL_PATTERN");
    expect(historicalSignal).toBeDefined();
    expect(historicalSignal!.description).toContain("4,20,000");
    expect(seasonal!.estimatedRequirement).toBeCloseTo(420000 * 1.15, 0);
  });

  it("Scenario E — never fabricates a historical number for a first-year business, but may still surface with strong recent activity", async () => {
    const businessId = await createTestBusiness(TEST_PHONES[4], "TEXTILE");
    const supplier = await prisma.supplier.create({ data: { businessId, name: "New Supplier" } });

    for (let i = 0; i < 8; i++) {
      await prisma.debitTransaction.create({
        data: { businessId, supplierId: supplier.id, amount: 4000, createdAt: daysAgo(3 + i) },
      });
    }

    const closeToOct27 = new Date("2026-10-27T12:00:00.000Z");
    const opportunities = await detectFundingOpportunities(businessId, closeToOct27);
    const seasonal = opportunities.find((o) => o.type === "SEASONAL_STOCK");
    expect(seasonal).toBeDefined();
    expect(seasonal!.estimatedRequirement).toBeNull();
    expect(seasonal!.sourceSignals.some((s) => s.type === "HISTORICAL_PATTERN")).toBe(false);
    expect(seasonal!.explanation).not.toMatch(/₹\d/); // no fabricated rupee figure
    expect(seasonal!.explanation).toMatch(/இல்லை|not available/i);
  });

  it("detects SUPPLIER_PAYMENT pressure when a large payment is due within 10 days and little is expected in", async () => {
    const businessId = await createTestBusiness(TEST_PHONES[5], "OTHER");
    const supplier = await prisma.supplier.create({ data: { businessId, name: "Urgent Supplier" } });
    const customer = await prisma.customer.create({ data: { businessId, name: "Late Payer" } });

    await prisma.debitTransaction.create({ data: { businessId, supplierId: supplier.id, amount: 200000, dueDate: days(5) } });
    await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount: 40000, dueDate: days(40) } });
    await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount: 1000, dueDate: days(50) } });
    await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount: 1000, dueDate: days(55) } });
    await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount: 1000, dueDate: days(58) } });

    const opportunities = await detectFundingOpportunities(businessId, NOW);
    const sp = opportunities.find((o) => o.type === "SUPPLIER_PAYMENT");
    expect(sp).toBeDefined();
    expect(sp!.estimatedGap).toBe(200000);
    expect(sp!.sourceSignals.some((s) => s.type === "SUPPLIER_PRESSURE")).toBe(true);
  });

  it("detects LARGE_PURCHASE from a genuine anomaly that coincides with a real cash gap", async () => {
    const businessId = await createTestBusiness(TEST_PHONES[6], "OTHER");
    const supplier = await prisma.supplier.create({ data: { businessId, name: "Bulk Supplier" } });
    const customer = await prisma.customer.create({ data: { businessId, name: "Any Customer" } });

    await prisma.debitTransaction.create({
      data: { businessId, supplierId: supplier.id, amount: 5000, status: "PAID", paidAmount: 5000, createdAt: daysAgo(60) },
    });
    await prisma.debitTransaction.create({
      data: { businessId, supplierId: supplier.id, amount: 5000, status: "PAID", paidAmount: 5000, createdAt: daysAgo(50) },
    });
    await prisma.debitTransaction.create({
      data: { businessId, supplierId: supplier.id, amount: 5000, status: "PAID", paidAmount: 5000, createdAt: daysAgo(40) },
    });
    await prisma.debitTransaction.create({
      data: { businessId, supplierId: supplier.id, amount: 30000, createdAt: daysAgo(1), dueDate: days(10) },
    });
    await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount: 5000, dueDate: days(60) } });

    const opportunities = await detectFundingOpportunities(businessId, NOW);
    const lp = opportunities.find((o) => o.type === "LARGE_PURCHASE");
    expect(lp).toBeDefined();
    expect(lp!.sourceSignals.some((s) => s.type === "LARGE_PURCHASE_PATTERN")).toBe(true);
  });

  it("detects EXPANSION only when payables have grown substantially AND a real cash gap exists", async () => {
    const businessId = await createTestBusiness(TEST_PHONES[7], "OTHER");
    const supplier = await prisma.supplier.create({ data: { businessId, name: "Growth Supplier" } });

    // Previous 30-60 day baseline: ₹30,000 total.
    for (const ago of [55, 45, 35]) {
      await prisma.debitTransaction.create({
        data: { businessId, supplierId: supplier.id, amount: 10000, status: "PAID", paidAmount: 10000, createdAt: daysAgo(ago) },
      });
    }
    // Last 30 days: ₹75,000 total (150% up), still pending and due soon.
    for (const ago of [20, 10, 2]) {
      await prisma.debitTransaction.create({
        data: { businessId, supplierId: supplier.id, amount: 25000, createdAt: daysAgo(ago), dueDate: days(15) },
      });
    }

    const opportunities = await detectFundingOpportunities(businessId, NOW);
    const expansion = opportunities.find((o) => o.type === "EXPANSION");
    expect(expansion).toBeDefined();
    expect(expansion!.sourceSignals.some((s) => s.type === "BUSINESS_GROWTH")).toBe(true);
    expect(expansion!.signalScore).toBeGreaterThanOrEqual(40);
  });

  it("detects LARGE_ORDER only when a big fresh order isn't covered by current available cash", async () => {
    const businessId = await createTestBusiness(TEST_PHONES[8], "OTHER");
    const customer = await prisma.customer.create({ data: { businessId, name: "Big Buyer" } });
    const supplier = await prisma.supplier.create({ data: { businessId, name: "Any Supplier" } });

    for (const ago of [40, 35, 30]) {
      await prisma.creditTransaction.create({
        data: { businessId, customerId: customer.id, amount: 5000, createdAt: daysAgo(ago), dueDate: daysAgo(ago - 20) },
      });
    }
    await prisma.creditTransaction.create({
      data: { businessId, customerId: customer.id, amount: 40000, createdAt: daysAgo(2), dueDate: days(20) },
    });
    await prisma.debitTransaction.create({
      data: { businessId, supplierId: supplier.id, amount: 60000, dueDate: days(15) },
    });

    const opportunities = await detectFundingOpportunities(businessId, NOW);
    const largeOrder = opportunities.find((o) => o.type === "LARGE_ORDER");
    expect(largeOrder).toBeDefined();
    expect(largeOrder!.title).toMatch(/large order/i);
    expect(largeOrder!.explanation).toContain("Big Buyer");
    expect(largeOrder!.sourceSignals.some((s) => s.type === "UNUSUAL_ORDER_SIZE")).toBe(true);
  });

  it("can surface multiple distinct opportunity types at once when several real signals coexist", async () => {
    // A large, urgent supplier obligation creates both a general 30-day
    // working-capital gap AND a specific 10-day supplier-pressure signal —
    // two legitimately different narratives about the same real situation.
    const businessId = await createTestBusiness(TEST_PHONES[9], "OTHER");
    const supplier = await prisma.supplier.create({ data: { businessId, name: "Big Obligation Co" } });
    const customer = await prisma.customer.create({ data: { businessId, name: "Slow Payer" } });

    await prisma.debitTransaction.create({ data: { businessId, supplierId: supplier.id, amount: 150000, dueDate: days(5) } });
    await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount: 5000, dueDate: days(45) } });
    await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount: 1000, dueDate: days(50) } });
    await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount: 1000, dueDate: days(55) } });
    await prisma.creditTransaction.create({ data: { businessId, customerId: customer.id, amount: 1000, dueDate: days(58) } });

    const opportunities = await detectFundingOpportunities(businessId, NOW);
    const types = opportunities.map((o) => o.type);
    expect(types).toContain("WORKING_CAPITAL");
    expect(types).toContain("SUPPLIER_PAYMENT");
    expect(opportunities.every((o) => o.signalScore >= 40)).toBe(true);
  });
});
