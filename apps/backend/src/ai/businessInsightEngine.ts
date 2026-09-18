import { getCashFlowSummary } from "./cashFlowAnalyzer";
import { computeBusinessHealth } from "./businessHealth";
import { getDailyPriorities } from "./dailyPriorities";
import { getSeasonalInsights } from "./seasonalIntelligence";
import { compareTrailingPeriods } from "./historicalIntelligence";
import { getBusinessPatterns } from "./businessPatterns";
import type { AiInsightCandidate, BusinessHealthStatus } from "./types";

const MAX_PRIORITY_INSIGHTS_PER_KIND = 3;

function healthStatusToSeverity(status: BusinessHealthStatus): AiInsightCandidate["severity"] {
  if (status === "STABLE") return "INFO";
  return status;
}

/**
 * Orchestrates every AI sub-service into one list of insight candidates.
 * This is the only place that combines cash-flow, health, priorities,
 * seasonal, historical, and pattern signals — everything else stays
 * single-purpose and independently testable.
 */
export async function generateInsightCandidates(businessId: string, now: Date = new Date()): Promise<AiInsightCandidate[]> {
  const candidates: AiInsightCandidate[] = [];

  const cashFlow = await getCashFlowSummary(businessId, now);
  const health = computeBusinessHealth(cashFlow);

  candidates.push({
    type: "BUSINESS_HEALTH",
    dedupeKey: "health",
    title: `Business health: ${health.status.replace("_", " ")}`,
    description: health.explanation,
    severity: healthStatusToSeverity(health.status),
    confidence: cashFlow.pendingReceivables + cashFlow.pendingPayables > 0 ? 0.8 : 0.5,
    sourceRefs: { cashFlow },
  });

  if (health.status !== "STABLE") {
    candidates.push({
      type: "CASH_PRESSURE",
      dedupeKey: "cash-pressure",
      title: "Cash pressure this week",
      description: health.explanation,
      severity: healthStatusToSeverity(health.status),
      confidence: 0.75,
      sourceRefs: { next7Days: cashFlow.next7Days },
    });
  }

  const priorities = await getDailyPriorities(businessId, now);
  const collectionPriorities = priorities.filter((p) => p.kind === "COLLECTION_DUE").slice(0, MAX_PRIORITY_INSIGHTS_PER_KIND);
  const paymentPriorities = priorities.filter((p) => p.kind === "PAYMENT_DUE").slice(0, MAX_PRIORITY_INSIGHTS_PER_KIND);

  for (const p of collectionPriorities) {
    candidates.push({
      type: "COLLECTION_DUE",
      dedupeKey: `collection-${p.refId}`,
      title: p.message.replace(/^[^\s]+\s/, ""),
      description: p.message,
      severity: p.severity === "HIGH" ? "HIGH_PRESSURE" : p.severity === "MEDIUM" ? "WATCH" : "INFO",
      confidence: 0.85,
      sourceRefs: { transactionId: p.refId },
      validUntil: p.dueDate,
    });
  }

  for (const p of paymentPriorities) {
    candidates.push({
      type: "PAYMENT_DUE",
      dedupeKey: `payment-${p.refId}`,
      title: p.message.replace(/^[^\s]+\s/, ""),
      description: p.message,
      severity: p.severity === "HIGH" ? "HIGH_PRESSURE" : p.severity === "MEDIUM" ? "WATCH" : "INFO",
      confidence: 0.85,
      sourceRefs: { transactionId: p.refId },
      validUntil: p.dueDate,
    });
  }

  const seasonal = await getSeasonalInsights(businessId, now);
  for (const s of seasonal) {
    candidates.push({
      type: "SEASONAL_PREPARATION",
      dedupeKey: `seasonal-${s.eventId}`,
      title: `${s.eventName} in ${s.daysAway} day${s.daysAway === 1 ? "" : "s"}`,
      description: `${s.note} ${s.estimate.message}`,
      severity: s.daysAway <= 14 ? "WATCH" : "INFO",
      confidence: s.estimate.hasHistoricalBasis ? 0.7 : 0.4,
      sourceRefs: { eventId: s.eventId, lastYearAmount: s.estimate.lastYearAmount },
      validUntil: s.eventDate,
    });
  }

  const historical = await compareTrailingPeriods(businessId, now);
  if (historical.hasData) {
    candidates.push({
      type: "HISTORICAL_PATTERN",
      dedupeKey: "historical-trend",
      title: "Purchase activity trend",
      description: historical.message,
      severity: "INFO",
      confidence: historical.confidence,
      sourceRefs: {
        currentPeriodTotal: historical.currentPeriodTotal,
        previousPeriodTotal: historical.previousPeriodTotal,
      },
    });
  }

  const patterns = await getBusinessPatterns(businessId, now);
  for (const pattern of patterns) {
    candidates.push({
      type: "PURCHASE_PATTERN",
      dedupeKey: `pattern-${pattern.type}-${pattern.refId ?? "trend"}`,
      title: patternTitle(pattern.type),
      description: pattern.message,
      severity: pattern.type === "LARGE_PURCHASE_ANOMALY" ? "WATCH" : "INFO",
      confidence: pattern.confidence,
      sourceRefs: { refId: pattern.refId, patternType: pattern.type },
    });
  }

  return candidates;
}

function patternTitle(type: string): string {
  switch (type) {
    case "RECURRING_SUPPLIER":
      return "Recurring supplier payment";
    case "RECURRING_CUSTOMER":
      return "Recurring customer collection";
    case "INCREASING_RECEIVABLES":
      return "Receivables trending up";
    case "INCREASING_PAYABLES":
      return "Payables trending up";
    case "LARGE_PURCHASE_ANOMALY":
      return "Unusually large purchase";
    default:
      return "Business pattern detected";
  }
}
