import { prisma } from "../db/prisma";
import { toNumber } from "../utils/decimal";
import { getCashFlowSummary, getCashFlowWindow } from "./cashFlowAnalyzer";
import { computeBusinessHealth } from "./businessHealth";
import { getSeasonalInsights } from "./seasonalIntelligence";
import { compareTrailingPeriods } from "./historicalIntelligence";
import { getBusinessPatterns } from "./businessPatterns";
import type {
  BusinessHealth,
  BusinessPattern,
  CashFlowSummary,
  CashFlowWindow,
  FundingOpportunityCandidate,
  FundingSignal,
  FundingUrgency,
  HistoricalComparison,
  SeasonalInsightItem,
} from "./types";

/**
 * Turns Phase 4 intelligence (cash-flow, health, seasonal, historical,
 * patterns) into funding opportunities — but only when real, meaningful
 * signals cross an explainable threshold. This deliberately does NOT fire
 * from "the user has a ledger" or "the user made one transaction"; see
 * MIN_TRANSACTION_COUNT/MIN_TOTAL_VOLUME and each detector's own gates.
 */

const MIN_TRANSACTION_COUNT = 5;
const MIN_TOTAL_VOLUME = 25000;
const MIN_SIGNAL_SCORE = 40;

const MAX_WEIGHT = {
  HISTORICAL_PATTERN: 20,
  LARGE_PURCHASE_PATTERN: 20,
  LARGE_ORDER: 25,
  UNUSUAL_ORDER_SIZE: 15,
} as const;

// Corroborating-signal cap, used when a broader 30-day cash-flow gap
// supports a different primary driver (large purchase, expansion).
const CORROBORATION_CASH_FLOW_GAP_MAX_WEIGHT = 20;

// Higher, dedicated caps for the two signals that are severe enough on
// their own to justify surfacing an opportunity with no corroboration at
// all (a >=80% cash-flow shortfall, or supplier payments due within 10
// days that collections barely touch) — both are 100% grounded in already-
// recorded transactions, unlike e.g. a seasonal estimate's uncertainty.
const PRIMARY_CASH_FLOW_GAP_MAX_WEIGHT = 50;
const PRIMARY_SUPPLIER_PRESSURE_MAX_WEIGHT = 45;

export interface ActivityStats {
  transactionCount: number;
  totalVolume: number;
  recentTransactionCount: number;
}

function formatInr(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function clampScore(signals: FundingSignal[]): number {
  return Math.min(100, Math.round(signals.reduce((sum, s) => sum + s.weight, 0)));
}

function avgConfidence(signals: FundingSignal[]): number {
  if (signals.length === 0) return 0;
  return Math.round((signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length) * 100) / 100;
}

function deriveUrgency(signalScore: number, escalate: boolean): FundingUrgency {
  if (signalScore >= 70 || escalate) return "HIGH";
  if (signalScore >= 55) return "MEDIUM";
  return "LOW";
}

export async function getActivityStats(businessId: string, now: Date): Promise<ActivityStats> {
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const [creditCount, debitCount, creditSum, debitSum, recentCredit, recentDebit] = await Promise.all([
    prisma.creditTransaction.count({ where: { businessId } }),
    prisma.debitTransaction.count({ where: { businessId } }),
    prisma.creditTransaction.aggregate({ where: { businessId }, _sum: { amount: true } }),
    prisma.debitTransaction.aggregate({ where: { businessId }, _sum: { amount: true } }),
    prisma.creditTransaction.count({ where: { businessId, createdAt: { gte: sixtyDaysAgo } } }),
    prisma.debitTransaction.count({ where: { businessId, createdAt: { gte: sixtyDaysAgo } } }),
  ]);

  return {
    transactionCount: creditCount + debitCount,
    totalVolume: toNumber(creditSum._sum.amount) + toNumber(debitSum._sum.amount),
    recentTransactionCount: recentCredit + recentDebit,
  };
}

function meetsMinimumActivity(activity: ActivityStats): boolean {
  return activity.transactionCount >= MIN_TRANSACTION_COUNT && activity.totalVolume >= MIN_TOTAL_VOLUME;
}

function detectWorkingCapital(
  cashFlow: CashFlowSummary,
  health: BusinessHealth,
  seasonal: SeasonalInsightItem[],
  historical: HistoricalComparison,
): FundingOpportunityCandidate | null {
  const { expectedCollections, expectedPayments, potentialGap: gap } = cashFlow.next30Days;
  if (cashFlow.pendingPayables < 20000) return null;
  if (gap < Math.max(20000, cashFlow.pendingPayables * 0.15)) return null;

  const signals: FundingSignal[] = [];
  const gapRatio = expectedPayments > 0 ? gap / expectedPayments : 1;
  signals.push({
    type: "CASH_FLOW_GAP",
    value: gap,
    weight: Math.round(Math.min(PRIMARY_CASH_FLOW_GAP_MAX_WEIGHT, PRIMARY_CASH_FLOW_GAP_MAX_WEIGHT * gapRatio)),
    source: "cashFlowAnalyzer",
    confidence: 0.75,
    description: `Expected payments over the next 30 days (${formatInr(expectedPayments)}) exceed expected collections (${formatInr(
      expectedCollections,
    )}) by approximately ${formatInr(gap)}.`,
  });

  const nearSeasonal = seasonal.find((s) => s.daysAway <= 30);
  if (nearSeasonal) {
    signals.push({
      type: "SEASONAL_DEMAND",
      value: nearSeasonal.daysAway,
      weight: 10,
      source: "seasonalIntelligence",
      confidence: 0.5,
      description: `${nearSeasonal.eventName} is ${nearSeasonal.daysAway} day(s) away, which may add to this requirement.`,
    });
  }

  if (historical.hasData && (historical.changePercent ?? 0) > 0) {
    signals.push({
      type: "HISTORICAL_PATTERN",
      value: historical.changePercent ?? 0,
      weight: 10,
      source: "historicalIntelligence",
      confidence: historical.confidence,
      description: historical.message,
    });
  }

  const signalScore = clampScore(signals);
  if (signalScore < MIN_SIGNAL_SCORE) return null;

  return {
    type: "WORKING_CAPITAL",
    dedupeKey: "working-capital",
    title: "Working capital gap",
    explanation: `Based on your recent business activity, expected payments over the next 30 days are ${formatInr(
      expectedPayments,
    )} while expected collections are approximately ${formatInr(expectedCollections)}. That's a possible working-capital gap of approximately ${formatInr(gap)}.`,
    estimatedRequirement: expectedPayments,
    estimatedAvailableCash: expectedCollections,
    estimatedGap: gap,
    urgency: deriveUrgency(signalScore, health.status === "HIGH_PRESSURE"),
    confidence: avgConfidence(signals),
    signalScore,
    sourceSignals: signals,
  };
}

function seasonalDemandWeight(daysAway: number): number {
  if (daysAway <= 7) return 30;
  if (daysAway <= 14) return 22;
  return 15;
}

function detectSeasonalStock(
  seasonal: SeasonalInsightItem[],
  cashFlow: CashFlowSummary,
  activity: ActivityStats,
): FundingOpportunityCandidate[] {
  const candidates: FundingOpportunityCandidate[] = [];

  for (const event of seasonal) {
    if (event.daysAway > 21) continue;
    if (!event.estimate.hasHistoricalBasis && activity.recentTransactionCount < 5) continue;

    const signals: FundingSignal[] = [
      {
        type: "SEASONAL_DEMAND",
        value: event.daysAway,
        weight: seasonalDemandWeight(event.daysAway),
        source: "seasonalIntelligence",
        confidence: 0.6,
        description: `${event.eventName} is ${event.daysAway} day(s) away.`,
      },
    ];

    if (activity.recentTransactionCount >= 8) {
      signals.push({
        type: "BUSINESS_GROWTH",
        value: activity.recentTransactionCount,
        weight: 10,
        source: "businessPatterns",
        confidence: 0.5,
        description: "Recent business activity has been strong.",
      });
    }

    let estimatedRequirement: number | null = null;
    let estimatedAvailableCash: number | null = null;
    let estimatedGap: number | null = null;

    if (event.estimate.hasHistoricalBasis && event.estimate.lastYearAmount) {
      estimatedRequirement = event.estimate.lastYearAmount * 1.15;
      estimatedAvailableCash = Math.max(cashFlow.pendingReceivables, 0);
      estimatedGap = Math.max(0, estimatedRequirement - estimatedAvailableCash);

      signals.push({
        type: "HISTORICAL_PATTERN",
        value: event.estimate.lastYearAmount,
        weight: MAX_WEIGHT.HISTORICAL_PATTERN,
        source: "historicalIntelligence",
        confidence: 0.7,
        description: event.estimate.message,
      });

      if (estimatedRequirement > 0) {
        const gapRatio = estimatedGap / estimatedRequirement;
        signals.push({
          type: "CASH_FLOW_GAP",
          value: estimatedGap,
          weight: Math.round(Math.min(CORROBORATION_CASH_FLOW_GAP_MAX_WEIGHT, CORROBORATION_CASH_FLOW_GAP_MAX_WEIGHT * gapRatio)),
          source: "cashFlowAnalyzer",
          confidence: 0.6,
          description: `Estimated available cash (${formatInr(estimatedAvailableCash)}) may fall short of the estimated stock requirement (${formatInr(
            estimatedRequirement,
          )}).`,
        });
      }
    }

    const signalScore = clampScore(signals);
    if (signalScore < MIN_SIGNAL_SCORE) continue;

    const explanationParts = [`${event.eventName} preparation period is approaching (${event.daysAway} day(s) away).`];
    if (estimatedRequirement && estimatedGap !== null) {
      explanationParts.push(
        `Based on your recent business activity, you may need approximately ${formatInr(
          estimatedRequirement,
        )} for stock. Your current estimated available cash is ${formatInr(estimatedAvailableCash ?? 0)}. Possible funding gap: ${formatInr(
          estimatedGap,
        )}.`,
      );
    } else {
      explanationParts.push(event.estimate.message);
    }

    candidates.push({
      type: "SEASONAL_STOCK",
      dedupeKey: `seasonal-${event.eventId}`,
      title: `${event.eventName} stock preparation`,
      explanation: explanationParts.join(" "),
      estimatedRequirement,
      estimatedAvailableCash,
      estimatedGap,
      urgency: deriveUrgency(signalScore, event.daysAway <= 7),
      confidence: avgConfidence(signals),
      signalScore,
      sourceSignals: signals,
      expiresAt: event.eventDate,
    });
  }

  return candidates;
}

function detectSupplierPayment(
  window10: CashFlowWindow,
  fullSummary: CashFlowSummary,
): FundingOpportunityCandidate | null {
  const { expectedCollections, expectedPayments, potentialGap: gap } = window10;
  if (expectedPayments < 30000) return null;
  if (gap <= 0 || gap < expectedPayments * 0.4) return null;

  const gapRatio = gap / expectedPayments;
  const signals: FundingSignal[] = [
    {
      type: "SUPPLIER_PRESSURE",
      value: gap,
      weight: Math.round(Math.min(PRIMARY_SUPPLIER_PRESSURE_MAX_WEIGHT, PRIMARY_SUPPLIER_PRESSURE_MAX_WEIGHT * gapRatio)),
      source: "cashFlowAnalyzer",
      confidence: 0.75,
      description: `${formatInr(expectedPayments)} supplier payments are expected within 10 days while expected collections are approximately ${formatInr(
        expectedCollections,
      )}.`,
    },
  ];

  if (fullSummary.next30Days.potentialGap > 0) {
    signals.push({
      type: "CASH_FLOW_GAP",
      value: fullSummary.next30Days.potentialGap,
      weight: 10,
      source: "cashFlowAnalyzer",
      confidence: 0.6,
      description: "The broader 30-day cash-flow outlook shows a gap as well.",
    });
  }

  const signalScore = clampScore(signals);
  if (signalScore < MIN_SIGNAL_SCORE) return null;

  return {
    type: "SUPPLIER_PAYMENT",
    dedupeKey: "supplier-pressure",
    title: "Supplier payment pressure",
    explanation: `${formatInr(expectedPayments)} supplier payments are expected within 10 days while expected collections are approximately ${formatInr(
      expectedCollections,
    )}. That's a possible gap of approximately ${formatInr(gap)}.`,
    estimatedRequirement: expectedPayments,
    estimatedAvailableCash: expectedCollections,
    estimatedGap: gap,
    urgency: deriveUrgency(signalScore, gapRatio >= 0.7),
    confidence: avgConfidence(signals),
    signalScore,
    sourceSignals: signals,
  };
}

function detectLargePurchase(patterns: BusinessPattern[], cashFlow: CashFlowSummary): FundingOpportunityCandidate | null {
  const pattern = patterns.find((p) => p.type === "LARGE_PURCHASE_ANOMALY");
  if (!pattern) return null;
  if (cashFlow.next30Days.potentialGap <= 0) return null;

  const gapRatio =
    cashFlow.next30Days.expectedPayments > 0 ? cashFlow.next30Days.potentialGap / cashFlow.next30Days.expectedPayments : 1;

  const signals: FundingSignal[] = [
    {
      type: "LARGE_PURCHASE_PATTERN",
      value: 1,
      weight: MAX_WEIGHT.LARGE_PURCHASE_PATTERN,
      source: "businessPatterns",
      confidence: pattern.confidence,
      description: pattern.message,
    },
    {
      type: "CASH_FLOW_GAP",
      value: cashFlow.next30Days.potentialGap,
      weight: Math.round(Math.min(CORROBORATION_CASH_FLOW_GAP_MAX_WEIGHT, CORROBORATION_CASH_FLOW_GAP_MAX_WEIGHT * gapRatio)),
      source: "cashFlowAnalyzer",
      confidence: 0.6,
      description: `Expected payments over the next 30 days exceed expected collections by approximately ${formatInr(
        cashFlow.next30Days.potentialGap,
      )}.`,
    },
  ];

  const signalScore = clampScore(signals);
  if (signalScore < MIN_SIGNAL_SCORE) return null;

  return {
    type: "LARGE_PURCHASE",
    dedupeKey: `large-purchase-${pattern.refId ?? "recent"}`,
    title: "Unusually large purchase",
    explanation: `${pattern.message} This coincides with an estimated 30-day cash gap of approximately ${formatInr(
      cashFlow.next30Days.potentialGap,
    )}.`,
    estimatedRequirement: cashFlow.next30Days.expectedPayments,
    estimatedAvailableCash: cashFlow.next30Days.expectedCollections,
    estimatedGap: cashFlow.next30Days.potentialGap,
    urgency: deriveUrgency(signalScore, false),
    confidence: avgConfidence(signals),
    signalScore,
    sourceSignals: signals,
  };
}

function expansionGrowthWeight(changeRatio: number): number {
  if (changeRatio >= 1) return 20;
  if (changeRatio >= 0.75) return 17;
  return 12;
}

function detectExpansion(patterns: BusinessPattern[], cashFlow: CashFlowSummary): FundingOpportunityCandidate | null {
  const pattern = patterns.find((p) => p.type === "INCREASING_PAYABLES" && (p.value ?? 0) >= 0.5);
  if (!pattern) return null;
  if (cashFlow.next30Days.potentialGap <= 0) return null;

  const gapRatio =
    cashFlow.next30Days.expectedPayments > 0 ? cashFlow.next30Days.potentialGap / cashFlow.next30Days.expectedPayments : 1;

  const signals: FundingSignal[] = [
    {
      type: "BUSINESS_GROWTH",
      value: pattern.value ?? 0,
      weight: expansionGrowthWeight(pattern.value ?? 0),
      source: "businessPatterns",
      confidence: pattern.confidence,
      description: pattern.message,
    },
    {
      type: "CASH_FLOW_GAP",
      value: cashFlow.next30Days.potentialGap,
      weight: Math.round(Math.min(CORROBORATION_CASH_FLOW_GAP_MAX_WEIGHT, CORROBORATION_CASH_FLOW_GAP_MAX_WEIGHT * gapRatio)),
      source: "cashFlowAnalyzer",
      confidence: 0.6,
      description: `Expected payments over the next 30 days exceed expected collections by approximately ${formatInr(
        cashFlow.next30Days.potentialGap,
      )}.`,
    },
  ];

  const signalScore = clampScore(signals);
  if (signalScore < MIN_SIGNAL_SCORE) return null;

  return {
    type: "EXPANSION",
    dedupeKey: "expansion-trend",
    title: "Business growth may need extra working capital",
    explanation: `${pattern.message} As your business activity grows, you may need extra working capital to keep up — the estimated 30-day cash gap is approximately ${formatInr(
      cashFlow.next30Days.potentialGap,
    )}.`,
    estimatedRequirement: cashFlow.next30Days.expectedPayments,
    estimatedAvailableCash: cashFlow.next30Days.expectedCollections,
    estimatedGap: cashFlow.next30Days.potentialGap,
    urgency: deriveUrgency(signalScore, false),
    confidence: avgConfidence(signals),
    signalScore,
    sourceSignals: signals,
  };
}

const LARGE_ORDER_MIN_RATIO = 3;
const LARGE_ORDER_MIN_PRIOR_COUNT = 3;
const LARGE_ORDER_RECENCY_DAYS = 14;

async function detectLargeOrder(
  businessId: string,
  now: Date,
  cashFlow: CashFlowSummary,
): Promise<FundingOpportunityCandidate | null> {
  const recent = await prisma.creditTransaction.findMany({
    where: { businessId },
    include: { customer: true },
    orderBy: { createdAt: "desc" },
    take: LARGE_ORDER_MIN_PRIOR_COUNT + 1,
  });

  if (recent.length < LARGE_ORDER_MIN_PRIOR_COUNT + 1) return null;

  const [latest, ...prior] = recent;
  const recencyLimit = new Date(now.getTime() - LARGE_ORDER_RECENCY_DAYS * 24 * 60 * 60 * 1000);
  if (latest.createdAt < recencyLimit) return null;
  if (latest.status === "PAID") return null;

  const latestAmount = toNumber(latest.amount);
  const priorAvg = prior.reduce((sum, t) => sum + toNumber(t.amount), 0) / prior.length;
  if (priorAvg <= 0) return null;

  const ratio = latestAmount / priorAvg;
  if (ratio < LARGE_ORDER_MIN_RATIO) return null;

  const availableCash = Math.max(cashFlow.netPosition, 0);
  const gap = Math.max(0, latestAmount - availableCash);
  if (gap <= 0) return null;

  const gapRatio = gap / latestAmount;
  const signals: FundingSignal[] = [
    {
      type: "LARGE_ORDER",
      value: gap,
      weight: Math.round(Math.min(MAX_WEIGHT.LARGE_ORDER, MAX_WEIGHT.LARGE_ORDER * gapRatio)),
      source: "cashFlowAnalyzer",
      confidence: 0.6,
      description: `Estimated available cash (${formatInr(availableCash)}) may not fully cover a recent order of ${formatInr(latestAmount)} from ${latest.customer.name}.`,
    },
    {
      type: "UNUSUAL_ORDER_SIZE",
      value: ratio,
      weight: Math.round(Math.min(MAX_WEIGHT.UNUSUAL_ORDER_SIZE, (MAX_WEIGHT.UNUSUAL_ORDER_SIZE * (ratio - LARGE_ORDER_MIN_RATIO)) / 3)),
      source: "businessPatterns",
      confidence: 0.6,
      description: `This order (${formatInr(latestAmount)}) is about ${ratio.toFixed(1)}x your typical order size (${formatInr(priorAvg)}).`,
    },
  ];

  const signalScore = clampScore(signals);
  if (signalScore < MIN_SIGNAL_SCORE) return null;

  return {
    type: "LARGE_ORDER",
    dedupeKey: `large-order-${latest.id}`,
    title: "Large order may need extra working capital",
    explanation: `A recent order of ${formatInr(latestAmount)} from ${latest.customer.name} is significantly larger than your typical order. Your estimated available cash is ${formatInr(
      availableCash,
    )}, leaving a possible gap of approximately ${formatInr(gap)} to fulfil it.`,
    estimatedRequirement: latestAmount,
    estimatedAvailableCash: availableCash,
    estimatedGap: gap,
    urgency: deriveUrgency(signalScore, gapRatio >= 0.7),
    confidence: avgConfidence(signals),
    signalScore,
    sourceSignals: signals,
  };
}

export async function detectFundingOpportunities(
  businessId: string,
  now: Date = new Date(),
): Promise<FundingOpportunityCandidate[]> {
  const activity = await getActivityStats(businessId, now);
  if (!meetsMinimumActivity(activity)) return [];

  const [cashFlow, window10, seasonal, historical, patterns] = await Promise.all([
    getCashFlowSummary(businessId, now),
    getCashFlowWindow(businessId, now, 10),
    getSeasonalInsights(businessId, now),
    compareTrailingPeriods(businessId, now, 30),
    getBusinessPatterns(businessId, now),
  ]);
  const health = computeBusinessHealth(cashFlow);

  const candidates: FundingOpportunityCandidate[] = [];

  const workingCapital = detectWorkingCapital(cashFlow, health, seasonal, historical);
  if (workingCapital) candidates.push(workingCapital);

  candidates.push(...detectSeasonalStock(seasonal, cashFlow, activity));

  const supplierPayment = detectSupplierPayment(window10, cashFlow);
  if (supplierPayment) candidates.push(supplierPayment);

  const largePurchase = detectLargePurchase(patterns, cashFlow);
  if (largePurchase) candidates.push(largePurchase);

  const expansion = detectExpansion(patterns, cashFlow);
  if (expansion) candidates.push(expansion);

  const largeOrder = await detectLargeOrder(businessId, now, cashFlow);
  if (largeOrder) candidates.push(largeOrder);

  return candidates.sort((a, b) => b.signalScore - a.signalScore);
}
