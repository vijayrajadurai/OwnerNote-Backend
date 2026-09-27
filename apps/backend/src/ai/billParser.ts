/**
 * Deterministic extractor for a photographed shop bill: the shop / company
 * name from the header lines and the bill's grand total — nothing else.
 * Item prices, tax lines and sub-totals are deliberately ignored, and a
 * field that can't be found is returned as null rather than guessed.
 */

export interface ParsedBill {
  shopName: string | null;
  total: number | null;
  /** 1 = explicit grand/net total wording, 2 = plain "Total" line. */
  totalTier: 1 | 2 | null;
}

const MAX_AMOUNT = 10_000_000;
const HEADER_SCAN_LINES = 6;

const TOTAL_WORD = "t[o0]t[a4][l1i]";

const STRONG_TOTAL = new RegExp(
  [
    `grand\\s*${TOTAL_WORD}`,
    `g\\.?\\s*${TOTAL_WORD}`,
    `net\\s*(payable|amount|amt|${TOTAL_WORD})`,
    "amount\\s*payable",
    "bill\\s*amount",
    `${TOTAL_WORD}\\s*(amount|amt|payable)`,
    "மொத்தம்",
  ].join("|"),
  "i",
);

const PLAIN_TOTAL = new RegExp(`\\b${TOTAL_WORD}\\b`, "i");

const NOT_A_BILL_TOTAL = new RegExp(
  `sub\\s*-?\\s*${TOTAL_WORD}|${TOTAL_WORD}\\s*(qty|quantity|items?|nos|tax|gst|cgst|sgst|igst|disc|discount|savings?|mrp|weight)`,
  "i",
);

const HEADER_NOISE =
  /gst|gstin|\bfssai\b|\btin\b|\bph\b|phone|\bmob|mobile|\bcell\b|\btel\b|e-?mail|@|www\.|\.com|invoice|cash\s*(memo|bill)|bill\s*no|receipt|\bdate\b|\btime\b|estimate|original|duplicate|customer|thank|welcome|counter|cashier/i;

const SHOP_HINT =
  /stores?|traders?|trading|agenc(y|ies)|enterprises?|mart\b|super\s*market|supermarket|hardwares?|electricals?|textiles?|medicals?|pharmacy|bakery|sweets|hotel|restaurant|provisions?|general|cent(re|er)|shop|depot|&\s*co\b|\bco\.|company|pvt|ltd|llp|kadai|கடை|ஸ்டோர்/i;

const AMOUNT_TOKEN = /\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/g;

function lastAmountIn(line: string): number | null {
  const matches = line.match(AMOUNT_TOKEN);
  if (!matches) return null;
  const value = Number.parseFloat(matches[matches.length - 1].replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0 || value > MAX_AMOUNT) return null;
  return value;
}

function extractTotal(lines: string[]): { total: number | null; tier: 1 | 2 | null } {
  let strong: number | null = null;
  let plain: number | null = null;

  lines.forEach((line, index) => {
    if (NOT_A_BILL_TOTAL.test(line)) return;
    const isStrong = STRONG_TOTAL.test(line);
    const isPlain = !isStrong && PLAIN_TOTAL.test(line);
    if (!isStrong && !isPlain) return;

    // Some bills print the figure on the line below the "Total" label.
    const value = lastAmountIn(line) ?? (index + 1 < lines.length ? lastAmountIn(lines[index + 1]) : null);
    if (value === null) return;

    // The last matching line wins: totals sit at the bottom of a bill.
    if (isStrong) strong = value;
    else plain = value;
  });

  if (strong !== null) return { total: strong, tier: 1 };
  if (plain !== null) return { total: plain, tier: 2 };
  return { total: null, tier: null };
}

function letterCount(line: string): number {
  return (line.match(/\p{L}/gu) ?? []).length;
}

function digitCount(line: string): number {
  return (line.match(/\d/g) ?? []).length;
}

function isHeaderCandidate(line: string): boolean {
  if (letterCount(line) < 3) return false;
  if (HEADER_NOISE.test(line)) return false;
  if (PLAIN_TOTAL.test(line) || STRONG_TOTAL.test(line)) return false;
  const digits = digitCount(line);
  return digits / Math.max(line.length, 1) <= 0.3;
}

function cleanShopName(line: string): string {
  let name = line
    .replace(/^[^\p{L}\d]+/u, "")
    .replace(/[^\p{L}\p{M}\d.)]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  const latin = name.replace(/[^A-Za-z]/g, "");
  if (latin.length > 0 && latin === latin.toUpperCase()) {
    name = name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }
  return name.slice(0, 60).trim();
}

function extractShopName(lines: string[]): string | null {
  const header = lines.slice(0, HEADER_SCAN_LINES).filter(isHeaderCandidate);
  const chosen = header.find((line) => SHOP_HINT.test(line)) ?? header[0];
  if (!chosen) return null;
  const cleaned = cleanShopName(chosen);
  return letterCount(cleaned) >= 3 ? cleaned : null;
}

export function parseBillText(text: string): ParsedBill {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const { total, tier } = extractTotal(lines);
  return { shopName: extractShopName(lines), total, totalTier: tier };
}
