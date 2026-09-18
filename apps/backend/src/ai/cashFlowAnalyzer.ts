import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { toNumber } from "../utils/decimal";
import type { CashFlowSummary, CashFlowWindow } from "./types";

function pendingBalance(amount: Prisma.Decimal, paidAmount: Prisma.Decimal): number {
  return toNumber(amount) - toNumber(paidAmount);
}

function windowFor(
  pending: { amount: Prisma.Decimal; paidAmount: Prisma.Decimal; dueDate: Date | null }[],
  now: Date,
  windowDays: number,
): number {
  const horizon = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
  return pending
    .filter((t) => t.dueDate && t.dueDate <= horizon)
    .reduce((sum, t) => sum + pendingBalance(t.amount, t.paidAmount), 0);
}

function buildWindow(expectedCollections: number, expectedPayments: number, windowDays: number): CashFlowWindow {
  return {
    windowDays,
    expectedCollections,
    expectedPayments,
    potentialGap: Math.max(0, expectedPayments - expectedCollections),
  };
}

/**
 * Computes the business's cash-flow position from live ledger data. All
 * figures are derived directly from stored CreditTransaction/
 * DebitTransaction rows — nothing here is estimated beyond what "pending"
 * and "due within N days" already imply, and callers must present these as
 * estimates ("expected", "approximate"), never as guaranteed facts.
 */
export async function getCashFlowSummary(businessId: string, now: Date = new Date()): Promise<CashFlowSummary> {
  const [allCredit, allDebit] = await Promise.all([
    prisma.creditTransaction.findMany({
      where: { businessId },
      select: { amount: true, paidAmount: true, dueDate: true, status: true },
    }),
    prisma.debitTransaction.findMany({
      where: { businessId },
      select: { amount: true, paidAmount: true, dueDate: true, status: true },
    }),
  ]);

  const totalReceivables = allCredit.reduce((sum, t) => sum + toNumber(t.amount), 0);
  const totalPayables = allDebit.reduce((sum, t) => sum + toNumber(t.amount), 0);

  const pendingCredit = allCredit.filter((t) => t.status !== "PAID");
  const pendingDebit = allDebit.filter((t) => t.status !== "PAID");

  const pendingReceivables = pendingCredit.reduce((sum, t) => sum + pendingBalance(t.amount, t.paidAmount), 0);
  const pendingPayables = pendingDebit.reduce((sum, t) => sum + pendingBalance(t.amount, t.paidAmount), 0);

  const collections7 = windowFor(pendingCredit, now, 7);
  const payments7 = windowFor(pendingDebit, now, 7);
  const collections30 = windowFor(pendingCredit, now, 30);
  const payments30 = windowFor(pendingDebit, now, 30);

  return {
    totalReceivables,
    totalPayables,
    pendingReceivables,
    pendingPayables,
    netPosition: pendingReceivables - pendingPayables,
    next7Days: buildWindow(collections7, payments7, 7),
    next30Days: buildWindow(collections30, payments30, 30),
    asOf: now.toISOString(),
  };
}

/**
 * Same "expected collections vs. payments within N days" computation as
 * getCashFlowSummary's fixed 7/30-day windows, for callers (Phase 5's
 * funding detector) that need a different horizon — e.g. the 10-day
 * supplier-payment-pressure check. Added for Phase 5; getCashFlowSummary's
 * behavior above is unchanged.
 */
export async function getCashFlowWindow(businessId: string, now: Date, windowDays: number): Promise<CashFlowWindow> {
  const [pendingCredit, pendingDebit] = await Promise.all([
    prisma.creditTransaction.findMany({
      where: { businessId, status: { not: "PAID" } },
      select: { amount: true, paidAmount: true, dueDate: true },
    }),
    prisma.debitTransaction.findMany({
      where: { businessId, status: { not: "PAID" } },
      select: { amount: true, paidAmount: true, dueDate: true },
    }),
  ]);

  const collections = windowFor(pendingCredit, now, windowDays);
  const payments = windowFor(pendingDebit, now, windowDays);
  return buildWindow(collections, payments, windowDays);
}
