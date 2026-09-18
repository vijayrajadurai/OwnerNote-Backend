import { prisma } from "../db/prisma";
import { toNumber } from "../utils/decimal";

const QUANTITY_WORDS = ["எவ்வளவு", "evlo"];
const RECEIVABLE_QUERY_VERBS = [
  "வாங்கணும்",
  "வாங்கணும",
  "வாங்கனும்",
  "வரணும்",
  "வரணும",
  "vaanganum",
  "vaanganam",
  "varanum",
];
const PAYABLE_QUERY_VERBS = ["கொடுக்கணும்", "கொடுக்கணும", "kudukanum"];
const AMBIGUOUS_QUERY_VERBS = ["தரணும்", "தரணும", "tharanum"];

function hasRealPartyDativeMarker(text: string): boolean {
  return /(க்கு|கிட்ட)\b/.test(text) || /\b(ku|kitta)\b/i.test(text);
}

function extractPartyName(rawText: string): string | null {
  const text = rawText.replace(/(எனக்கு|enakku|naanukku)/gi, " ");

  const particleMatch = /([A-Za-z][A-Za-z\s]{1,40}?)[\s-]?(ku|kitta)\b/i.exec(text);
  if (particleMatch) {
    const words = particleMatch[1].trim().split(/\s+/).filter((w) => /^[A-Za-z]+$/.test(w));
    const name = words.slice(-3).join(" ");
    if (name) return name;
  }

  const tamilParticleMatch = /([஀-௿]{2,20}?)(க்கு|கிட்ட)/.exec(text);
  if (tamilParticleMatch) {
    const name = tamilParticleMatch[1].trim();
    if (name) return name;
  }

  const leadingTamilName = /^\s*([஀-௿]{2,20})(?=\s|$)/.exec(text);
  if (leadingTamilName) {
    return leadingTamilName[1].trim();
  }

  const properNoun = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})\b/.exec(text);
  if (properNoun) return properNoun[1];

  return null;
}

export function classifyPartyBalanceQuery(
  question: string,
): { name: string; direction: "RECEIVABLE" | "PAYABLE" } | null {
  const lower = question.toLowerCase();
  if (!QUANTITY_WORDS.some((w) => lower.includes(w))) return null;

  let direction: "RECEIVABLE" | "PAYABLE" | null = null;
  if (PAYABLE_QUERY_VERBS.some((w) => lower.includes(w))) {
    direction = "PAYABLE";
  } else if (RECEIVABLE_QUERY_VERBS.some((w) => lower.includes(w))) {
    direction = "RECEIVABLE";
  } else if (AMBIGUOUS_QUERY_VERBS.some((w) => lower.includes(w))) {
    direction = hasRealPartyDativeMarker(lower) ? "PAYABLE" : "RECEIVABLE";
  }
  if (!direction) return null;

  const name = extractPartyName(question);
  if (!name) return null;

  return { name, direction };
}

function formatInr(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

interface PartyBalanceSummary {
  total: number;
  pendingCount: number;
  hasAnyRecord: boolean;
}

function buildPartyBalanceAnswer(
  name: string,
  direction: "RECEIVABLE" | "PAYABLE",
  summary: PartyBalanceSummary,
): string {
  if (!summary.hasAnyRecord) {
    return `${name} பெயரில் பதிவு செய்யப்பட்ட நிலுவைத் தொகை என்கிட்ட இல்லை.`;
  }
  if (summary.total <= 0) {
    return direction === "RECEIVABLE"
      ? `${name} உங்களுக்கு தர வேண்டிய தொகை தற்போது இல்லை.`
      : `${name}-க்கு நீங்க கொடுக்க வேண்டிய தொகை தற்போது இல்லை.`;
  }
  const amountText = formatInr(summary.total);
  if (direction === "RECEIVABLE") {
    return summary.pendingCount > 1
      ? `${name} உங்களுக்கு மொத்தம் ${amountText} தரணும்.`
      : `${name} உங்களுக்கு ${amountText} தரணும்.`;
  }
  return summary.pendingCount > 1
    ? `நீங்க ${name}-க்கு மொத்தம் ${amountText} கொடுக்கணும்.`
    : `நீங்க ${name}-க்கு ${amountText} கொடுக்கணும்.`;
}

async function getPartyReceivableSummary(businessId: string, name: string): Promise<PartyBalanceSummary> {
  const rows = await prisma.creditTransaction.findMany({
    where: {
      businessId,
      customer: { name: { equals: name, mode: "insensitive" } },
    },
    select: { amount: true, paidAmount: true, status: true },
  });
  const pending = rows.filter((r) => r.status !== "PAID");
  const total = pending.reduce((sum, r) => sum + toNumber(r.amount) - toNumber(r.paidAmount), 0);
  return { total, pendingCount: pending.length, hasAnyRecord: rows.length > 0 };
}

async function getPartyPayableSummary(businessId: string, name: string): Promise<PartyBalanceSummary> {
  const rows = await prisma.debitTransaction.findMany({
    where: {
      businessId,
      supplier: { name: { equals: name, mode: "insensitive" } },
    },
    select: { amount: true, paidAmount: true, status: true },
  });
  const pending = rows.filter((r) => r.status !== "PAID");
  const total = pending.reduce((sum, r) => sum + toNumber(r.amount) - toNumber(r.paidAmount), 0);
  return { total, pendingCount: pending.length, hasAnyRecord: rows.length > 0 };
}

export async function answerPartyBalanceQuery(
  businessId: string,
  question: string,
): Promise<{ answer: string; confidence: number } | null> {
  const classified = classifyPartyBalanceQuery(question);
  if (!classified) return null;

  const summary =
    classified.direction === "RECEIVABLE"
      ? await getPartyReceivableSummary(businessId, classified.name)
      : await getPartyPayableSummary(businessId, classified.name);

  return {
    answer: buildPartyBalanceAnswer(classified.name, classified.direction, summary),
    confidence: 0.9,
  };
}
