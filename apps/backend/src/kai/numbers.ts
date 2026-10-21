/**
 * Money and arithmetic, done by code — never by a model (KAI principle 3: deterministic arithmetic).
 * The evaluator is a small recursive-descent parser over numbers and + - * / % ( ); nothing is ever eval'd.
 */

/** Kai's write limit, the same as the app's (₹99 crore — owner, 21 Oct 2026: "1 crore la irunthu 99 crore varaikkum"). */
export const MAX_LEDGER_AMOUNT = 990_000_000;

const MULTIPLIERS: Record<string, number> = {
  k: 1_000, thousand: 1_000, aayiram: 1_000, ayiram: 1_000, aayram: 1_000,
  aayirathuku: 1_000, aayirathukku: 1_000, aayiratthukku: 1_000, aayirathula: 1_000,
  lakh: 100_000, lakhs: 100_000, lac: 100_000, laksham: 100_000, latcham: 100_000,
  crore: 10_000_000, crores: 10_000_000, cr: 10_000_000,
};

/**
 * Every amount in the owner's words: "500", "1,500", "₹2.5k", "2 lakh", "rs.750". A day of the month ("5-aam thethi",
 * "5th") and a phone number are not amounts.
 */
export function amountsIn(text: string): number[] {
  const out: number[] = [];
  const re = /(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|aayirathuku|aayirathukku|aayiratthukku|aayirathula|aayiram|ayiram|aayram|lakhs?|lac|laksham|latcham|crores?|cr)?(?![\p{L}\d])/giu;
  for (const m of text.matchAll(re)) {
    const digits = m[1].replace(/,/g, "");
    const after = text.slice((m.index ?? 0) + m[0].length);
    if (/^\s*(?:-?\s*(?:aam|am|th|st|nd|rd)\b|\s*(?:thethi|thedhi|date|tharikh))/i.test(after)) continue;
    if (!m[2] && !m[1].includes(",") && digits.replace(".", "").length >= 10) continue; // a phone number (990000000 is ₹99 crore)
    let value = Number(digits);
    if (!Number.isFinite(value)) continue;
    if (m[2]) value *= MULTIPLIERS[m[2].toLowerCase()] ?? 1;
    out.push(Math.round(value * 100) / 100);
  }
  return out;
}

// Money said in words ("moonu aayiram", "rendaayiram", "aayirathu ainooru"), only when no figure was said.
const UNITS: Record<string, number> = {
  onnu: 1, oru: 1, rendu: 2, irandu: 2, moonu: 3, naalu: 4, anju: 5, aaru: 6, ezhu: 7, ettu: 8, ombodhu: 9, pathu: 10,
};
const HUNDREDS: Record<string, number> = {
  nooru: 100, irunooru: 200, munnooru: 300, naanooru: 400, ainooru: 500, arunooru: 600, ezhunooru: 700, ennooru: 800, thollaayiram: 900,
};
const THOUSANDS: Record<string, number> = {
  aayiram: 1000, aayirathu: 1000, rendaayiram: 2000, moovaayiram: 3000, naalaayiram: 4000, anjaayiram: 5000, aaraayiram: 6000,
  ezhaayiram: 7000, ettaayiram: 8000, pathaayiram: 10000,
};

export function amountInWords(text: string): number | undefined {
  const words = text.toLowerCase().replace(/[.,!?]/g, " ").split(/\s+/).filter(Boolean);
  let total = 0;
  let pending = 0;
  let seen = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (UNITS[w] !== undefined && (THOUSANDS[words[i + 1]] === 1000 || HUNDREDS[words[i + 1]] === 100 || /^lakh/.test(words[i + 1] ?? ""))) {
      pending = UNITS[w];
    } else if (THOUSANDS[w] !== undefined) {
      total += (pending || 1) * THOUSANDS[w];
      pending = 0;
      seen = true;
    } else if (HUNDREDS[w] !== undefined) {
      total += (pending || 1) * HUNDREDS[w];
      pending = 0;
      seen = true;
    } else if (/^lakh/.test(w)) {
      total += (pending || 1) * 100000;
      pending = 0;
      seen = true;
    } else if (seen && UNITS[w] !== undefined && i === words.length - 1) {
      total += UNITS[w];
    } else if (seen) {
      break;
    }
  }
  return seen && total > 0 ? total : undefined;
}

type Token = { type: "num"; value: number } | { type: "op"; value: string };

function tokenize(expression: string): Token[] | null {
  const tokens: Token[] = [];
  const re = /\s*(?:(\d[\d,]*(?:\.\d+)?)|([+\-*/%()]))/y;
  let pos = 0;
  while (pos < expression.length) {
    re.lastIndex = pos;
    const m = re.exec(expression);
    if (!m) {
      if (/^\s+$/.test(expression.slice(pos))) break;
      return null;
    }
    if (m[1] !== undefined) tokens.push({ type: "num", value: Number(m[1].replace(/,/g, "")) });
    else tokens.push({ type: "op", value: m[2] });
    pos = re.lastIndex;
  }
  return tokens;
}

/** Evaluates "1200 + 18%", "(500 * 3) - 250", "18% of 500" (written "500 * 18%"). Null if it isn't arithmetic. */
export function evaluate(expression: string): number | null {
  const tokens = tokenize(expression);
  if (!tokens || tokens.length === 0) return null;
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (v: string) => peek()?.type === "op" && peek()!.value === v;

  // factor := ('-')? (number | '(' expr ')') ('%')?
  function factor(): { value: number; percent: boolean } {
    if (isOp("-")) {
      i++;
      const f = factor();
      return { value: -f.value, percent: f.percent };
    }
    let value: number;
    const t = peek();
    if (t?.type === "num") {
      value = t.value;
      i++;
    } else if (isOp("(")) {
      i++;
      value = expr();
      if (!isOp(")")) throw new Error("unbalanced");
      i++;
    } else throw new Error("expected number");
    if (isOp("%")) {
      i++;
      return { value, percent: true };
    }
    return { value, percent: false };
  }

  function term(): number {
    const first = factor();
    let value = first.percent ? first.value / 100 : first.value;
    while (isOp("*") || isOp("/")) {
      const op = (peek() as Token).value;
      i++;
      const f = factor();
      const rhs = f.percent ? f.value / 100 : f.value;
      if (op === "/") {
        if (rhs === 0) throw new Error("division by zero");
        value /= rhs;
      } else value *= rhs;
    }
    return value;
  }

  function expr(): number {
    let value = term();
    while (isOp("+") || isOp("-")) {
      const op = (peek() as Token).value;
      i++;
      const start = i;
      const f = factor();
      // "1200 + 18%" adds 18% of 1200, as a shop calculator does.
      let rhs: number;
      if (f.percent && !(isOp("*") || isOp("/"))) rhs = (value * f.value) / 100;
      else {
        i = start;
        rhs = term();
      }
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  try {
    const value = expr();
    if (i !== tokens.length || !Number.isFinite(value)) return null;
    return Math.round(value * 100) / 100;
  } catch {
    return null;
  }
}

/** The sum in the owner's words, written as an expression: "500 plus 300", "1200 la 18% gst", "18% of 500". */
export function expressionIn(text: string): string | null {
  const s = text
    .toLowerCase()
    .replace(/₹|rs\.?/g, "")
    .replace(/(\d)\s*(?:x|×|into|times|multiplied by|perukku)\s*(?=\d)/g, "$1 * ")
    .replace(/(?:÷|divided by|by|vagu)\s*(?=\d)/g, " / ")
    .replace(/\s(?:plus|kootu|serthu|and)\s(?=\d)/g, " + ")
    .replace(/\s(?:minus|kazhi|kalichu|less)\s(?=\d)/g, " - ")
    .replace(/(\d+(?:\.\d+)?)\s*%\s*(?:of|la|il)\s*(\d[\d,]*(?:\.\d+)?)/g, "$2 * $1%")
    .replace(/(\d[\d,]*(?:\.\d+)?)\s*(?:ku|-ku|la|-la|on|for)\s*(\d+(?:\.\d+)?)\s*%\s*(?:gst|tax|vari)/g, "$1 + $2%");
  const m = s.match(/[\d(][\d\s,.()+\-*/%]*[\d)%]/g);
  if (!m) return null;
  const candidate = m.sort((a, b) => b.length - a.length)[0].trim();
  // At least one operator between two numbers (or a percentage), not just "500" or a date like "12-10".
  if (!/\d\s*[+*/%]|\d\s+-\s*\d|\)\s*[+\-*/]/.test(candidate)) return null;
  return candidate;
}
