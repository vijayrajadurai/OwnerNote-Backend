import { prisma } from "../db/prisma";
import { toNumber } from "../utils/decimal";
import { getCashFlowSummary } from "./cashFlowAnalyzer";
import type { PriorityItem, PrioritySeverity } from "./types";

const LOOKAHEAD_DAYS = 7;
const MAX_PRIORITIES = 6;

function daysUntil(dueDate: Date, now: Date): number {
  const diffMs = dueDate.getTime() - now.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

function severityFor(days: number): PrioritySeverity {
  if (days <= 0) return "HIGH";
  if (days <= 3) return "MEDIUM";
  return "LOW";
}

function emojiFor(severity: PrioritySeverity): string {
  switch (severity) {
    case "HIGH":
      return "🔴";
    case "MEDIUM":
      return "🟠";
    case "LOW":
      return "🟡";
    default:
      return "🟢";
  }
}

function dueDescription(days: number): string {
  if (days < 0) return `overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`;
  if (days === 0) return "due today";
  return `due in ${days} day${days === 1 ? "" : "s"}`;
}

const severityRank: Record<PrioritySeverity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, NONE: 3 };

/**
 * Ranked "what needs attention today" list, derived from pending credit/
 * debit transactions and custom reminders. Recomputed fresh on every call
 * (today's priorities are inherently a point-in-time view, not something to
 * persist).
 */
export async function getDailyPriorities(businessId: string, now: Date = new Date()): Promise<PriorityItem[]> {
  const [pendingCredit, pendingDebit, reminders, cashFlow] = await Promise.all([
    prisma.creditTransaction.findMany({
      where: { businessId, status: { not: "PAID" }, dueDate: { not: null } },
      include: { customer: true },
    }),
    prisma.debitTransaction.findMany({
      where: { businessId, status: { not: "PAID" }, dueDate: { not: null } },
      include: { supplier: true },
    }),
    prisma.reminder.findMany({ where: { businessId, isDone: false } }),
    getCashFlowSummary(businessId, now),
  ]);

  const items: PriorityItem[] = [];

  for (const t of pendingCredit) {
    const days = daysUntil(t.dueDate as Date, now);
    if (days > LOOKAHEAD_DAYS) continue;
    const severity = severityFor(days);
    const pending = toNumber(t.amount) - toNumber(t.paidAmount);
    items.push({
      kind: "COLLECTION_DUE",
      severity,
      amount: pending,
      dueDate: (t.dueDate as Date).toISOString(),
      refId: t.id,
      message: `${emojiFor(severity)} Collect ₹${pending.toLocaleString("en-IN")} from ${t.customer.name} — ${dueDescription(days)}`,
    });
  }

  for (const t of pendingDebit) {
    const days = daysUntil(t.dueDate as Date, now);
    if (days > LOOKAHEAD_DAYS) continue;
    const severity = severityFor(days);
    const pending = toNumber(t.amount) - toNumber(t.paidAmount);
    items.push({
      kind: "PAYMENT_DUE",
      severity,
      amount: pending,
      dueDate: (t.dueDate as Date).toISOString(),
      refId: t.id,
      message: `${emojiFor(severity)} ₹${pending.toLocaleString("en-IN")} payment to ${t.supplier.name} — ${dueDescription(days)}`,
    });
  }

  for (const r of reminders) {
    const days = daysUntil(r.dueDate, now);
    if (days > LOOKAHEAD_DAYS) continue;
    const severity = severityFor(days);
    items.push({
      kind: "REMINDER",
      severity,
      dueDate: r.dueDate.toISOString(),
      refId: r.id,
      message: `${emojiFor(severity)} ${r.title} — ${dueDescription(days)}`,
    });
  }

  if (cashFlow.next30Days.potentialGap > cashFlow.next7Days.potentialGap && cashFlow.next30Days.potentialGap > 0) {
    items.push({
      kind: "CASH_PRESSURE",
      severity: "LOW",
      message: "🟡 Cash pressure may increase in the coming weeks, based on upcoming payments.",
    });
  }

  items.sort((a, b) => {
    const rankDiff = severityRank[a.severity] - severityRank[b.severity];
    if (rankDiff !== 0) return rankDiff;
    if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    return 0;
  });

  if (items.length === 0) {
    return [
      {
        kind: "ALL_CLEAR",
        severity: "NONE",
        message: "🟢 No major payment pressure detected.",
      },
    ];
  }

  return items.slice(0, MAX_PRIORITIES);
}
