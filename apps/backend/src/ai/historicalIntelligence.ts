import { prisma } from "../db/prisma";
import { toNumber } from "../utils/decimal";
import type { HistoricalComparison } from "./types";

/**
 * All historical comparisons below only ever look at rows that actually
 * exist in CreditTransaction/DebitTransaction/BusinessEvent — there is no
 * fabricated or estimated historical number anywhere in this file. When the
 * relevant window has no data, callers get hasData:false and an honest
 * message instead of a guess.
 */

async function sumDebitActivity(businessId: string, start: Date, end: Date): Promise<{ total: number; count: number }> {
  const [debitRows, eventRows] = await Promise.all([
    prisma.debitTransaction.findMany({
      where: { businessId, createdAt: { gte: start, lt: end } },
      select: { amount: true },
    }),
    prisma.businessEvent.findMany({
      where: { businessId, eventType: "STOCK_PURCHASE", occurredAt: { gte: start, lt: end } },
      select: { amount: true },
    }),
  ]);

  const total =
    debitRows.reduce((sum, r) => sum + toNumber(r.amount), 0) +
    eventRows.reduce((sum, r) => sum + toNumber(r.amount), 0);
  return { total, count: debitRows.length + eventRows.length };
}

/**
 * Compares business (purchase/stock-in) activity over the trailing N days
 * against the N days before that — works from day one of the app's own
 * transaction history, unlike a year-over-year comparison.
 */
export async function compareTrailingPeriods(
  businessId: string,
  now: Date = new Date(),
  periodDays = 30,
): Promise<HistoricalComparison> {
  const periodMs = periodDays * 24 * 60 * 60 * 1000;
  const currentStart = new Date(now.getTime() - periodMs);
  const previousStart = new Date(now.getTime() - 2 * periodMs);

  const [current, previous] = await Promise.all([
    sumDebitActivity(businessId, currentStart, now),
    sumDebitActivity(businessId, previousStart, currentStart),
  ]);

  if (previous.count === 0) {
    return {
      hasData: false,
      label: `Last ${periodDays} days vs. the ${periodDays} days before`,
      message:
        "Not enough historical data yet to compare — the earlier period has no recorded purchase activity. This will improve as more data is collected.",
      confidence: 0,
    };
  }

  const changePercent = previous.total === 0 ? 0 : ((current.total - previous.total) / previous.total) * 100;
  const direction = current.total > previous.total ? "up" : current.total < previous.total ? "down" : "flat";

  return {
    hasData: true,
    label: `Last ${periodDays} days vs. the ${periodDays} days before`,
    message: `Purchase activity is ${direction} ${Math.abs(Math.round(changePercent))}% compared to the previous ${periodDays} days (₹${Math.round(
      previous.total,
    ).toLocaleString("en-IN")} → ₹${Math.round(current.total).toLocaleString("en-IN")}), based on recorded transactions.`,
    currentPeriodTotal: current.total,
    previousPeriodTotal: previous.total,
    changePercent: Math.round(changePercent),
    confidence: Math.min(0.4 + previous.count * 0.1, 0.9),
  };
}

/**
 * Looks for real purchase activity in the same lead-time window last year
 * (e.g. the 45 days before Diwali), for use as a seasonal preparation
 * estimate. Returns hasData:false with an honest message when nothing was
 * recorded — this is the expected outcome for a first-year user, per spec.
 */
export async function getHistoricalWindowTotal(
  businessId: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<HistoricalComparison> {
  const { total, count } = await sumDebitActivity(businessId, windowStart, windowEnd);

  if (count === 0) {
    return {
      hasData: false,
      label: "Same period last year",
      message: "Previous-year business data இன்னும் available இல்லை. இந்த வருட data collect ஆன பிறகு next year better comparison கொடுக்க முடியும்.",
      confidence: 0,
    };
  }

  return {
    hasData: true,
    label: "Same period last year",
    message: `Last year same period-la ₹${Math.round(total).toLocaleString("en-IN")} purchase activity irundhichu, based on ${count} recorded transaction${count === 1 ? "" : "s"}.`,
    currentPeriodTotal: undefined,
    previousPeriodTotal: total,
    confidence: Math.min(0.4 + count * 0.1, 0.85),
  };
}
