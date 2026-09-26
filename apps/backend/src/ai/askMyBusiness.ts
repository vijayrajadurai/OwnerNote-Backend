import { prisma } from "../db/prisma";
import { toNumber } from "../utils/decimal";
import { getCashFlowSummary } from "./cashFlowAnalyzer";
import { computeBusinessHealth } from "./businessHealth";
import { getSeasonalInsights } from "./seasonalIntelligence";
import { compareTrailingPeriods } from "./historicalIntelligence";
import type { AskAnswer } from "./types";
import { answerPartyBalanceQuery } from "./partyBalance";
import { listProducts } from "../modules/inventory/inventory.service";
import { listMyOffers } from "../modules/offers/offers.service";
import { listRequests as listGroupBuyingRequests } from "../modules/groupBuying/groupBuying.service";

/**
 * Rule-based question router — not an LLM. Each matcher below calls the
 * same services the REST endpoints use, so an answer is only ever built
 * from real business data (never a generic canned reply pretending to be
 * data-backed). `AiQuestionAnswerer` is the seam an LLM-backed
 * implementation would plug into later without callers changing.
 */
export interface AiQuestionAnswerer {
  answer(businessId: string, question: string, now?: Date): Promise<AskAnswer>;
}

function formatInr(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

async function answerSituation(businessId: string, now: Date): Promise<{ answer: string; confidence: number }> {
  const cashFlow = await getCashFlowSummary(businessId, now);
  const health = computeBusinessHealth(cashFlow);
  return {
    answer: `Business health: ${health.status.replace("_", " ")}. ${health.explanation} Pending receivable: ${formatInr(
      cashFlow.pendingReceivables,
    )}, pending payable: ${formatInr(cashFlow.pendingPayables)}.`,
    confidence: 0.8,
  };
}

async function answerWhoToCollect(businessId: string): Promise<{ answer: string; confidence: number }> {
  const pending = await prisma.creditTransaction.findMany({
    where: { businessId, status: { not: "PAID" } },
    include: { customer: true },
  });
  if (pending.length === 0) {
    return { answer: "No pending collections right now.", confidence: 0.9 };
  }
  const byCustomer = new Map<string, number>();
  for (const t of pending) {
    const balance = toNumber(t.amount) - toNumber(t.paidAmount);
    byCustomer.set(t.customer.name, (byCustomer.get(t.customer.name) ?? 0) + balance);
  }
  const top = [...byCustomer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const list = top.map(([name, amount]) => `${name} (${formatInr(amount)})`).join(", ");
  return { answer: `Collect from: ${list}.`, confidence: 0.85 };
}

async function answerNext7Days(businessId: string, now: Date): Promise<{ answer: string; confidence: number }> {
  const cashFlow = await getCashFlowSummary(businessId, now);
  const { expectedCollections, expectedPayments, potentialGap } = cashFlow.next7Days;
  const gapText =
    potentialGap > 0
      ? ` Estimated possible cash gap of approximately ${formatInr(potentialGap)}.`
      : " Expected collections cover expected payments.";
  return {
    answer: `Next 7 days: expected collections ${formatInr(expectedCollections)}, expected payments ${formatInr(
      expectedPayments,
    )}.${gapText}`,
    confidence: 0.8,
  };
}

async function answerNextMonthPrep(businessId: string, now: Date): Promise<{ answer: string; confidence: number }> {
  const cashFlow = await getCashFlowSummary(businessId, now);
  const seasonal = await getSeasonalInsights(businessId, now);
  const parts = [
    `Next 30 days: expected collections ${formatInr(cashFlow.next30Days.expectedCollections)}, expected payments ${formatInr(
      cashFlow.next30Days.expectedPayments,
    )}.`,
  ];
  if (seasonal.length > 0) {
    const next = seasonal[0];
    parts.push(`${next.eventName} is ${next.daysAway} day${next.daysAway === 1 ? "" : "s"} away — ${next.estimate.message}`);
  } else {
    parts.push("No major seasonal event detected in the near term for your business category.");
  }
  return { answer: parts.join(" "), confidence: 0.65 };
}

async function answerCashShortage(businessId: string, now: Date): Promise<{ answer: string; confidence: number }> {
  const cashFlow = await getCashFlowSummary(businessId, now);
  const health = computeBusinessHealth(cashFlow);
  if (health.status === "STABLE") {
    return { answer: `Based on available data, no cash shortage is expected right now. ${health.explanation}`, confidence: 0.75 };
  }
  return {
    answer: `A possible cash shortage may occur. ${health.explanation} This is an estimate based on currently recorded transactions, not a guarantee.`,
    confidence: 0.7,
  };
}

async function answerMonthComparison(businessId: string, now: Date): Promise<{ answer: string; confidence: number }> {
  const comparison = await compareTrailingPeriods(businessId, now, 30);
  return { answer: comparison.message, confidence: comparison.confidence };
}

// Strips the question's own trigger words so what's left is (hopefully) the
// product name — same heuristic used by the mobile clients' voice parsers.
// Never guesses beyond that: an unmatched name gets an honest "not found"
// answer below, never a fabricated stock figure.
function extractProductName(question: string): string {
  return question
    .replace(/\?/g, "")
    .replace(/\b(stock|inventory|how many|how much|quantity|left|remaining|available|evlo|irukka|irukku|kammi)\b/gi, "")
    .trim();
}

async function answerInventoryStock(businessId: string, question: string): Promise<{ answer: string; confidence: number }> {
  const products = await listProducts(businessId);
  const target = extractProductName(question).toLowerCase();
  const product =
    products.find((p) => p.name.toLowerCase() === target) ??
    (target.length > 0 ? products.find((p) => p.name.toLowerCase().includes(target) || target.includes(p.name.toLowerCase())) : undefined);
  if (!product) {
    return { answer: "I couldn't find that product in your inventory.", confidence: 0.3 };
  }
  return { answer: `${product.name}: ${product.currentStock} ${product.unit} in stock.`, confidence: 0.85 };
}

async function answerLocalOffers(businessId: string): Promise<{ answer: string; confidence: number }> {
  const offers = await listMyOffers(businessId);
  const active = offers.filter((o) => o.status === "ACTIVE");
  if (active.length === 0) {
    return { answer: "You have no active local offers right now.", confidence: 0.85 };
  }
  const list = active
    .slice(0, 5)
    .map((o) => o.title)
    .join(", ");
  return { answer: `You have ${active.length} active offer${active.length === 1 ? "" : "s"}: ${list}.`, confidence: 0.85 };
}

async function answerGroupBuying(businessId: string): Promise<{ answer: string; confidence: number }> {
  const requests = await listGroupBuyingRequests(businessId);
  const open = requests.filter((r) => r.status === "ACTIVE" || r.status === "MATCHED" || r.status === "JOINED");
  if (open.length === 0) {
    return { answer: "You have no open group-buying requests right now.", confidence: 0.85 };
  }
  const list = open
    .slice(0, 5)
    .map((r) => `${r.productId} (${r.quantity} ${r.unit})`)
    .join(", ");
  return { answer: `You have ${open.length} open group-buying request${open.length === 1 ? "" : "s"}: ${list}.`, confidence: 0.85 };
}

const INVENTORY_STOCK_PATTERN = /\bstock\b|\binventory\b/i;
const LOCAL_OFFER_PATTERN = /\boffer/i;
const GROUP_BUYING_PATTERN = /group[\s-]?buying/i;

const INTENT_MATCHERS: {
  intent: string;
  pattern: RegExp;
  handler: (businessId: string, now: Date) => Promise<{ answer: string; confidence: number }>;
}[] = [
  { intent: "CASH_SHORTAGE", pattern: /shortage|cash gap|shortfall|varuma/i, handler: answerCashShortage },
  { intent: "WHO_TO_COLLECT", pattern: /yaar|who.*collect|collect.*from/i, handler: (id) => answerWhoToCollect(id) },
  { intent: "NEXT_7_DAYS", pattern: /next\s*7\s*days?|this week.*payment/i, handler: answerNext7Days },
  { intent: "NEXT_MONTH_PREP", pattern: /next month|prepare/i, handler: answerNextMonthPrep },
  { intent: "MONTH_COMPARISON", pattern: /last month.*compar|improve/i, handler: answerMonthComparison },
  { intent: "BUSINESS_SITUATION", pattern: /situation|epdi|how.*business|how is my business/i, handler: answerSituation },
  // Checked before BUSINESS_SITUATION's "situation" pattern in practice
  // doesn't overlap (neither "offer" nor "group buying" contains
  // "situation"/"epdi"), so array order here doesn't matter — first-match
  // scanning still finds the right one either way.
  { intent: "LOCAL_OFFER_QUERY", pattern: LOCAL_OFFER_PATTERN, handler: (id) => answerLocalOffers(id) },
  { intent: "GROUP_BUYING_QUERY", pattern: GROUP_BUYING_PATTERN, handler: (id) => answerGroupBuying(id) },
];

class RuleBasedAnswerer implements AiQuestionAnswerer {
  async answer(businessId: string, question: string, now: Date = new Date()): Promise<AskAnswer> {
    const partyBalance = await answerPartyBalanceQuery(businessId, question);
    if (partyBalance) {
      return {
        question,
        matchedIntent: "PARTY_BALANCE",
        answer: partyBalance.answer,
        confidence: partyBalance.confidence,
      };
    }

    // Checked before the generic matcher loop — its handler needs the raw
    // question text (to extract a product name), not `now`, so it can't
    // live in INTENT_MATCHERS alongside the (businessId, now) handlers.
    if (INVENTORY_STOCK_PATTERN.test(question)) {
      const { answer, confidence } = await answerInventoryStock(businessId, question);
      return { question, matchedIntent: "INVENTORY_STOCK_QUERY", answer, confidence };
    }

    const lower = question.toLowerCase();
    for (const matcher of INTENT_MATCHERS) {
      if (matcher.pattern.test(lower)) {
        const { answer, confidence } = await matcher.handler(businessId, now);
        return { question, matchedIntent: matcher.intent, answer, confidence };
      }
    }
    return {
      question,
      matchedIntent: "UNKNOWN",
      answer:
        "I couldn't understand that question yet. Try asking about collections, payments, cash shortage, or next month's preparation.",
      confidence: 0,
    };
  }
}

export function getQuestionAnswerer(): AiQuestionAnswerer {
  return new RuleBasedAnswerer();
}
