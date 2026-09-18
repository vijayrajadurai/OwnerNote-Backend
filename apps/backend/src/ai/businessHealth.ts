import type { BusinessHealth, CashFlowSummary } from "./types";

const WATCH_RATIO = 0.3;
const PRESSURE_RATIO = 0.7;

function formatInr(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

/**
 * Pure function: derives an explainable health status from an already-
 * computed CashFlowSummary. No DB access here, so it's trivial to unit
 * test with crafted summaries.
 */
export function computeBusinessHealth(summary: CashFlowSummary): BusinessHealth {
  const { expectedCollections, expectedPayments, potentialGap } = summary.next7Days;

  if (summary.pendingReceivables === 0 && summary.pendingPayables === 0) {
    return {
      status: "STABLE",
      explanation: "No pending payments or collections right now — nothing to prepare for.",
    };
  }

  if (potentialGap <= 0) {
    return {
      status: "STABLE",
      explanation:
        expectedPayments > 0
          ? `Expected collections in the next 7 days (${formatInr(expectedCollections)}) cover expected payments (${formatInr(expectedPayments)}).`
          : "No major payment pressure detected in the next 7 days, based on available data.",
    };
  }

  const gapRatio = expectedPayments > 0 ? potentialGap / expectedPayments : 1;
  const status = gapRatio <= WATCH_RATIO ? "WATCH" : gapRatio <= PRESSURE_RATIO ? "PRESSURE" : "HIGH_PRESSURE";

  const explanation = `Upcoming 7-day payments (${formatInr(expectedPayments)}) are higher than expected collections (${formatInr(
    expectedCollections,
  )}) by approximately ${formatInr(potentialGap)}, based on available data.`;

  return { status, explanation };
}
