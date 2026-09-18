import type { ParsedTransaction, TransactionIntent } from "./types";

/**
 * Rule-based Tamil / Tanglish / English transaction extractor.
 *
 * This is deliberately NOT an LLM call: it is a deterministic, testable
 * heuristic parser that covers the phrasing patterns from the product spec
 * ("Kumar-ku 2000-ku ... tharanum", "Murugan Traders-kitta ... vaangiruken").
 * It returns a confidence score and the caller (voice module + mobile
 * confirm screen) always shows the result to the owner for CONFIRM/EDIT
 * before anything is written to the database — the parser never writes
 * directly. Swapping this for an LLM-backed implementation later only
 * requires satisfying the same `ParsedTransaction` contract.
 */

const ASK_QUANTITY_WORDS = ["எவ்வளவு", "evlo"];
const ASK_QUERY_VERBS = [
  "தரணும்",
  "தரணும",
  "tharanum",
  "வாங்கணும்",
  "வாங்கணும",
  "vaanganum",
  "வரணும்",
  "வரணும",
  "varanum",
  "கொடுக்கணும்",
  "கொடுக்கணும",
  "kudukanum",
];

const CREDIT_KEYWORDS = [
  "credit",
  "vaanganum",
  "vaanganam",
  "tharanum",
  "tharuvanga",
  "receivable",
  "collect",
  "வாங்கணும்",
  "வாங்க வேண்டும்",
];
const DEBIT_KEYWORDS = [
  "debit",
  "payment",
  "pay ",
  "vaangiruken",
  "vaangi",
  "purchase",
  "payable",
  "kudukanum",
  "கொடுக்கணும்",
  "கொடுக்க வேண்டும்",
];
const CASH_SALE_KEYWORDS = ["cash sale", "cash-a vitten", "cash vachu vitten"];

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      // Preserve short all-caps words as-is (likely acronyms like "ABC", "GST").
      if (word.length <= 5 && word === word.toUpperCase()) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function nextWeekdayDate(today: Date, targetDow: number): Date {
  const result = new Date(today);
  const diff = (targetDow + 7 - today.getDay()) % 7 || 7;
  result.setDate(result.getDate() + diff);
  return result;
}

function extractDueDate(lowerText: string, now: Date): { date: Date | null; matched: string | null } {
  if (/\btoday\b|\binnaikki\b|\binnaiku\b/.test(lowerText)) {
    const match = /\btoday\b|\binnaikki\b|\binnaiku\b/.exec(lowerText);
    return { date: new Date(now), matched: match?.[0] ?? null };
  }

  if (/\btomorrow\b|\bnaalaikki\b|\bnalaikki\b/.test(lowerText)) {
    const match = /\btomorrow\b|\bnaalaikki\b|\bnalaikki\b/.exec(lowerText);
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    return { date, matched: match?.[0] ?? null };
  }

  const inDaysMatch = /\bin\s+(\d+)\s+days?\b/.exec(lowerText);
  if (inDaysMatch) {
    const date = new Date(now);
    date.setDate(date.getDate() + Number(inDaysMatch[1]));
    return { date, matched: inDaysMatch[0] };
  }

  for (let dow = 0; dow < WEEKDAYS.length; dow++) {
    const weekdayRegex = new RegExp(`\\b(next\\s+)?${WEEKDAYS[dow]}\\b`);
    const match = weekdayRegex.exec(lowerText);
    if (match) {
      return { date: nextWeekdayDate(now, dow), matched: match[0] };
    }
  }

  const ordinalMatch = /\b(\d{1,2})(st|nd|rd|th)\b(\s*date)?/.exec(lowerText);
  if (ordinalMatch) {
    const day = Number(ordinalMatch[1]);
    if (day >= 1 && day <= 31) {
      const date = new Date(now.getFullYear(), now.getMonth(), day);
      if (date < now) date.setMonth(date.getMonth() + 1);
      return { date, matched: ordinalMatch[0] };
    }
  }

  return { date: null, matched: null };
}

function extractAmount(text: string): { amount: number | null; matched: string | null } {
  const amountRegex = /(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k\b|thousand|lakhs?|l\b)?/gi;
  let match: RegExpExecArray | null;
  while ((match = amountRegex.exec(text)) !== null) {
    const numericPart = match[1].replace(/,/g, "");
    if (!numericPart || Number.isNaN(Number(numericPart))) continue;
    let amount = Number(numericPart);
    const suffix = match[2]?.toLowerCase();
    if (suffix === "k" || suffix === "thousand") amount *= 1000;
    if (suffix === "l" || suffix?.startsWith("lakh")) amount *= 100000;
    if (amount > 0) return { amount, matched: match[0] };
  }
  return { amount: null, matched: null };
}

function isAskQuery(lowerText: string): boolean {
  if (/\d/.test(lowerText)) return false;
  const hasQuantityWord = ASK_QUANTITY_WORDS.some((w) => lowerText.includes(w));
  const hasVerb = ASK_QUERY_VERBS.some((w) => lowerText.includes(w));
  return hasQuantityWord && hasVerb;
}

function extractPartyName(rawText: string): string | null {
  const text = rawText.replace(/(எனக்கு|enakku|naanukku)/gi, " ");

  const particleMatch = /([A-Za-z][A-Za-z\s]{1,40}?)[\s-]?(ku|kitta)\b/i.exec(text);
  if (particleMatch) {
    const words = particleMatch[1]
      .trim()
      .split(/\s+/)
      .filter((w) => /^[A-Za-z]+$/.test(w));
    const name = words.slice(-3).join(" ");
    if (name) return titleCase(name);
  }

  const tamilParticleMatch = /([஀-௿]{2,20}?)(க்கு|கிட்ட)/.exec(text);
  if (tamilParticleMatch) {
    const name = tamilParticleMatch[1].trim();
    if (name) return name;
  }

  const leadingTamilName = /^\s*([஀-௿]{2,20})(?=\s|$)/.exec(text);
  if (leadingTamilName) {
    const name = leadingTamilName[1].trim();
    if (name) return name;
  }

  const properNoun = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})\b/.exec(text);
  if (properNoun) return properNoun[1];

  return null;
}

function detectIntent(lowerText: string): { intent: TransactionIntent; matchedKeyword: boolean } {
  if (isAskQuery(lowerText)) {
    return { intent: "ASK_QUERY", matchedKeyword: true };
  }
  if (CASH_SALE_KEYWORDS.some((kw) => lowerText.includes(kw))) {
    return { intent: "CASH_SALE", matchedKeyword: true };
  }
  if (DEBIT_KEYWORDS.some((kw) => lowerText.includes(kw))) {
    return { intent: "CREATE_DEBIT", matchedKeyword: true };
  }
  if (CREDIT_KEYWORDS.some((kw) => lowerText.includes(kw))) {
    return { intent: "CREATE_CREDIT", matchedKeyword: true };
  }
  return { intent: "UNKNOWN", matchedKeyword: false };
}

export function parseTransactionText(rawText: string, now: Date = new Date()): ParsedTransaction {
  const lowerText = rawText.toLowerCase();

  const { intent, matchedKeyword } = detectIntent(lowerText);
  const { date: dueDate, matched: dateMatch } = extractDueDate(lowerText, now);
  const textWithoutDate = dateMatch ? lowerText.replace(dateMatch, " ") : lowerText;
  const { amount } = extractAmount(textWithoutDate);
  const partyName = intent === "CASH_SALE" ? null : extractPartyName(rawText);

  let confidence = 0.3;
  if (amount !== null) confidence += 0.25;
  if (partyName !== null || intent === "CASH_SALE") confidence += 0.25;
  if (matchedKeyword) confidence += 0.2;
  confidence = Math.min(confidence, 0.95);

  return {
    intent,
    partyName,
    amount,
    currency: "INR",
    dueDate: dueDate ? dueDate.toISOString() : null,
    description: rawText.trim(),
    confidence: Math.round(confidence * 100) / 100,
    rawText,
  };
}
