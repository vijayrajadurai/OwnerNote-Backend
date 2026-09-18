import { prisma } from "../../db/prisma";
import { toNumber } from "../../utils/decimal";
import { getBusinessForUser } from "../business/business.service";

export interface DashboardSnapshot {
  businessName: string;
  receivableTotal: number;
  payableTotal: number;
  netPosition: number;
  upcoming7DayPayments: number;
  upcoming7DayCollections: number;
  insights: string[];
}

/**
 * Phase 2 dashboard: real receivable/payable totals from credit and debit
 * transactions. The richer "estimated cash gap" narrative from the cash-flow
 * engine (Phase 4) builds on top of these same totals.
 */
export async function getDashboardSnapshot(userId: string): Promise<DashboardSnapshot> {
  const business = await getBusinessForUser(userId);
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [pendingCredit, pendingDebit] = await Promise.all([
    prisma.creditTransaction.findMany({
      where: { businessId: business.id, status: { not: "PAID" } },
      include: { customer: true },
    }),
    prisma.debitTransaction.findMany({
      where: { businessId: business.id, status: { not: "PAID" } },
      include: { supplier: true },
    }),
  ]);

  const receivableTotal = pendingCredit.reduce((sum, t) => sum + toNumber(t.amount) - toNumber(t.paidAmount), 0);
  const payableTotal = pendingDebit.reduce((sum, t) => sum + toNumber(t.amount) - toNumber(t.paidAmount), 0);

  const upcoming7DayCollections = pendingCredit
    .filter((t) => t.dueDate && t.dueDate <= in7Days)
    .reduce((sum, t) => sum + toNumber(t.amount) - toNumber(t.paidAmount), 0);

  const upcoming7DayPayments = pendingDebit
    .filter((t) => t.dueDate && t.dueDate <= in7Days)
    .reduce((sum, t) => sum + toNumber(t.amount) - toNumber(t.paidAmount), 0);

  const overdueCredit = pendingCredit.filter((t) => t.dueDate && t.dueDate < now);
  const uniqueCustomersOwing = new Set(pendingCredit.map((t) => t.customer.id)).size;

  const insights: string[] = [];
  if (pendingCredit.length === 0 && pendingDebit.length === 0) {
    insights.push("Start recording credit and debit entries to see your business position here.");
  } else {
    if (uniqueCustomersOwing > 0) {
      insights.push(`${uniqueCustomersOwing} customers-kitta ₹${receivableTotal.toLocaleString("en-IN")} collect panna pending.`);
    }
    if (overdueCredit.length > 0) {
      insights.push(`${overdueCredit.length} customers-ku payment overdue.`);
    }
    if (upcoming7DayPayments > upcoming7DayCollections) {
      const gap = upcoming7DayPayments - upcoming7DayCollections;
      insights.push(
        `Next 7 days-la payment ₹${upcoming7DayPayments.toLocaleString("en-IN")} irukku. Expected collection ₹${upcoming7DayCollections.toLocaleString(
          "en-IN",
        )} mattum. Approx ₹${gap.toLocaleString("en-IN")} temporary cash gap varalam.`,
      );
    }
  }

  return {
    businessName: business.businessName,
    receivableTotal,
    payableTotal,
    netPosition: receivableTotal - payableTotal,
    upcoming7DayPayments,
    upcoming7DayCollections,
    insights,
  };
}
