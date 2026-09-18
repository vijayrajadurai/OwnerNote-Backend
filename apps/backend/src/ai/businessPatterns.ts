import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { toNumber } from "../utils/decimal";
import type { BusinessPattern } from "./types";

const MIN_TRANSACTIONS_FOR_RECURRING = 3;
const TREND_INCREASE_THRESHOLD = 0.2; // 20%
const LARGE_PURCHASE_MULTIPLIER = 2;

/**
 * Detects patterns strictly from recorded transactions. Every threshold
 * below exists to avoid calling something a "pattern" on too little data —
 * see MIN_TRANSACTIONS_FOR_RECURRING in particular.
 */
export async function getBusinessPatterns(businessId: string, now: Date = new Date()): Promise<BusinessPattern[]> {
  const [debitTransactions, creditTransactions] = await Promise.all([
    prisma.debitTransaction.findMany({
      where: { businessId },
      include: { supplier: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.creditTransaction.findMany({
      where: { businessId },
      include: { customer: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const patterns: BusinessPattern[] = [];

  patterns.push(...detectRecurringSuppliers(debitTransactions));
  patterns.push(...detectRecurringCustomers(creditTransactions));
  patterns.push(...detectLargePurchaseAnomaly(debitTransactions));

  const receivablesTrend = detectTrend(
    creditTransactions.map((t) => ({ amount: toNumber(t.amount), createdAt: t.createdAt })),
    now,
    "INCREASING_RECEIVABLES",
    "receivables",
  );
  if (receivablesTrend) patterns.push(receivablesTrend);

  const payablesTrend = detectTrend(
    debitTransactions.map((t) => ({ amount: toNumber(t.amount), createdAt: t.createdAt })),
    now,
    "INCREASING_PAYABLES",
    "payables",
  );
  if (payablesTrend) patterns.push(payablesTrend);

  return patterns;
}

interface DebitWithSupplier {
  id: string;
  amount: Prisma.Decimal;
  supplierId: string;
  supplier: { name: string };
}

interface CreditWithCustomer {
  id: string;
  amount: Prisma.Decimal;
  customerId: string;
  customer: { name: string };
}

function detectRecurringSuppliers(transactions: DebitWithSupplier[]): BusinessPattern[] {
  const bySupplier = new Map<string, { name: string; amounts: number[] }>();
  for (const t of transactions) {
    const entry = bySupplier.get(t.supplierId) ?? { name: t.supplier.name, amounts: [] };
    entry.amounts.push(toNumber(t.amount));
    bySupplier.set(t.supplierId, entry);
  }

  const patterns: BusinessPattern[] = [];
  for (const [supplierId, entry] of bySupplier) {
    if (entry.amounts.length < MIN_TRANSACTIONS_FOR_RECURRING) continue;
    const avg = entry.amounts.reduce((s, a) => s + a, 0) / entry.amounts.length;
    patterns.push({
      type: "RECURRING_SUPPLIER",
      refId: supplierId,
      confidence: Math.min(0.5 + entry.amounts.length * 0.05, 0.9),
      message: `Recurring payments to ${entry.name} — ${entry.amounts.length} transactions recorded, averaging ₹${Math.round(avg).toLocaleString("en-IN")}.`,
    });
  }
  return patterns;
}

function detectRecurringCustomers(transactions: CreditWithCustomer[]): BusinessPattern[] {
  const byCustomer = new Map<string, { name: string; amounts: number[] }>();
  for (const t of transactions) {
    const entry = byCustomer.get(t.customerId) ?? { name: t.customer.name, amounts: [] };
    entry.amounts.push(toNumber(t.amount));
    byCustomer.set(t.customerId, entry);
  }

  const patterns: BusinessPattern[] = [];
  for (const [customerId, entry] of byCustomer) {
    if (entry.amounts.length < MIN_TRANSACTIONS_FOR_RECURRING) continue;
    const avg = entry.amounts.reduce((s, a) => s + a, 0) / entry.amounts.length;
    patterns.push({
      type: "RECURRING_CUSTOMER",
      refId: customerId,
      confidence: Math.min(0.5 + entry.amounts.length * 0.05, 0.9),
      message: `Recurring collections from ${entry.name} — ${entry.amounts.length} transactions recorded, averaging ₹${Math.round(avg).toLocaleString("en-IN")}.`,
    });
  }
  return patterns;
}

function detectLargePurchaseAnomaly(transactions: DebitWithSupplier[]): BusinessPattern[] {
  const bySupplier = new Map<string, { name: string; amounts: number[]; lastId: string }>();
  for (const t of transactions) {
    const amount = toNumber(t.amount);
    const entry = bySupplier.get(t.supplierId) ?? { name: t.supplier.name, amounts: [], lastId: t.id };
    entry.amounts.push(amount);
    entry.lastId = t.id;
    bySupplier.set(t.supplierId, entry);
  }

  const patterns: BusinessPattern[] = [];
  for (const entry of bySupplier.values()) {
    if (entry.amounts.length < MIN_TRANSACTIONS_FOR_RECURRING) continue;
    const lastAmount = entry.amounts[entry.amounts.length - 1];
    const priorAmounts = entry.amounts.slice(0, -1);
    const avg = priorAmounts.reduce((s, a) => s + a, 0) / priorAmounts.length;
    if (avg > 0 && lastAmount > avg * LARGE_PURCHASE_MULTIPLIER) {
      patterns.push({
        type: "LARGE_PURCHASE_ANOMALY",
        refId: entry.lastId,
        confidence: 0.7,
        message: `Latest purchase from ${entry.name} (₹${Math.round(lastAmount).toLocaleString("en-IN")}) is well above the usual average of ₹${Math.round(avg).toLocaleString("en-IN")}.`,
      });
    }
  }
  return patterns;
}

function detectTrend(
  transactions: { amount: number; createdAt: Date }[],
  now: Date,
  type: "INCREASING_RECEIVABLES" | "INCREASING_PAYABLES",
  label: string,
): BusinessPattern | null {
  const periodMs = 30 * 24 * 60 * 60 * 1000;
  const currentStart = new Date(now.getTime() - periodMs);
  const previousStart = new Date(now.getTime() - 2 * periodMs);

  const current = transactions.filter((t) => t.createdAt >= currentStart && t.createdAt <= now);
  const previous = transactions.filter((t) => t.createdAt >= previousStart && t.createdAt < currentStart);

  if (previous.length < MIN_TRANSACTIONS_FOR_RECURRING) return null;

  const currentTotal = current.reduce((s, t) => s + t.amount, 0);
  const previousTotal = previous.reduce((s, t) => s + t.amount, 0);
  if (previousTotal === 0) return null;

  const changeRatio = (currentTotal - previousTotal) / previousTotal;
  if (changeRatio < TREND_INCREASE_THRESHOLD) return null;

  return {
    type,
    confidence: Math.min(0.5 + previous.length * 0.05, 0.85),
    // Raw ratio for callers (Phase 5's funding detector) that need a stricter
    // threshold than this pattern's own 20% detection floor — the message
    // above is unchanged.
    value: changeRatio,
    message: `New ${label} in the last 30 days (₹${Math.round(currentTotal).toLocaleString("en-IN")}) are up ${Math.round(
      changeRatio * 100,
    )}% versus the previous 30 days (₹${Math.round(previousTotal).toLocaleString("en-IN")}).`,
  };
}
