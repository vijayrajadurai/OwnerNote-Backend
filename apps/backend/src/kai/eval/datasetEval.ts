import { understand } from "../intent";
import { sameName } from "../names";
import type { PartyRef, Understanding } from "../types";

/**
 * Scores KAI on the owner's datasets (rows of { intent, ta, th, en }: the same line in Tamil script — as the mic writes
 * it — in typed Tanglish, and in English). Two kinds:
 *  - "intents": the labels are trusted (Kai_Local_Tamil_Thanglish_100000): each label says what Kai must do.
 *  - "topics":  the labels are not usable (Kai_100000_Dataset: the same sentence carries up to 28 labels), so the
 *               expected report topic is read from the English sentence's own words.
 * Also checks that typed and mic Tamil give the same result (CLAUDE.md: the text box and the mic are one Kai).
 * `npm run kai:dataset -- <file.json> [intents|topics]` runs it on a whole file.
 */

export interface DatasetRow {
  id?: number;
  intent: string;
  ta: string;
  th: string;
  en: string;
}

export interface DatasetReport {
  lines: number;
  byLang: Record<string, { ok: number; total: number }>;
  sameTypedAndMic: number;
  failures: { lang: string; intent: string; text: string; why: string; got: string }[];
}

const WRITES = new Set(["ADD_CREDIT", "ADD_DEBIT", "RECORD_PAYMENT"]);

function nameOf(u: Understanding): string {
  const p = u.party;
  return p.status === "FOUND" ? p.party.name : p.status === "UNKNOWN" ? p.said : p.status === "AMBIGUOUS" ? "?" : "";
}

/** The person a line is about, as the English sentence names them (a capitalized word, or one the shop knows). */
function expectedName(row: DatasetRow, parties: PartyRef[]): string | undefined {
  const known = parties.find((p) => new RegExp(`\\b${p.name}(?:'s)?\\b`, "i").test(row.en));
  if (known) return known.name;
  const skip = /^(?:I|Add|Show|Record|Increase|Change|Delete|Remove|How|Who|What|Which|Whose|Is|Did|Was|There|You|Tell|Please|Today|Yesterday|Tomorrow|This|It)$/;
  const words = row.en.match(/\b[A-Z][a-z]+\b/g) ?? [];
  return words.find((w) => !skip.test(w));
}

function checkIntent(row: DatasetRow, u: Understanding, parties: PartyRef[]): string | null {
  const got = nameOf(u);
  const saidInEnglish = got !== "" && got !== "?" && (row.en.match(/\p{L}+/gu) ?? []).some((w) => sameName(w, got));
  const name = WRITES.has(u.intent) || /CHECK_(?:RECEIVABLE|PAYABLE|HISTORY)|ADD_|PAY|RECEIVE/.test(row.intent) ? expectedName(row, parties) ?? (saidInEnglish ? got : undefined) : undefined;
  const figure = row.th.match(/\d[\d,]*/);
  // No figure in the line ("Kumar enakku panam kuduthaar"): Kai must ask how much, not invent one.
  const amount = figure ? Number(figure[0].replace(/,/g, "")) : undefined;
  const nameOk = !name || (got !== "" && got !== "?" && sameName(got, name));
  const need = (ok: boolean, why: string) => (ok ? null : why);
  const report = (topic: string) => u.intent === "REPORT" && u.report?.topic === topic;
  switch (row.intent) {
    case "ADD_RECEIVABLE":
    case "ADD_ADDITIONAL_RECEIVABLE":
      return need(u.intent === "ADD_CREDIT", "intent") ?? need(nameOk, "name") ?? need(u.amount === amount, "amount");
    case "ADD_PAYABLE":
    case "ADD_ADDITIONAL_PAYABLE":
      return need(u.intent === "ADD_DEBIT", "intent") ?? need(nameOk, "name") ?? need(u.amount === amount, "amount");
    case "PAYMENT_RECEIVED":
      if (!figure) return need(!(WRITES.has(u.intent) && u.amount !== undefined), "wrote an entry");
      return need(u.intent === "RECORD_PAYMENT", "intent") ?? need(nameOk, "name") ?? need(u.amount === amount, "amount");
    case "RECEIVE_PAYMENT":
      return need(u.intent === "RECORD_PAYMENT" && (u.direction === "THEY_GAVE" || u.direction === "I_TOOK"), "intent") ?? need(nameOk, "name") ?? need(u.amount === amount, "amount");
    case "PAY_PAYMENT":
      return need(u.direction === "I_GAVE" && WRITES.has(u.intent), "intent") ?? need(nameOk, "name") ?? need(u.amount === amount, "amount");
    case "ADD_EXPENSE":
      return need(u.intent === "HOW_TO" && u.howTo === "EXPENSE", "intent");
    case "ADD_SALE":
      return need(u.intent === "HOW_TO" && u.howTo === "SALE", "intent");
    case "ADD_PURCHASE":
      return need(u.intent === "HOW_TO" && u.howTo === "PURCHASE", "intent");
    case "CHECK_RECEIVABLE":
    case "CHECK_PAYABLE":
      return need(u.intent === "PARTY_BALANCE", "intent") ?? need(nameOk, "name");
    case "CHECK_HISTORY":
      return name ? need(u.intent === "PARTY_BALANCE", "intent") ?? need(nameOk, "name") : need(report("HISTORY"), "intent");
    case "CHECK_ALL_RECEIVABLES":
      return need(u.intent === "TOTAL_RECEIVABLE" || u.intent === "OVERDUE", "intent");
    case "CHECK_ALL_PAYABLES":
      return need(u.intent === "TOTAL_PAYABLE", "intent");
    case "CHECK_ALL_PENDING":
      return need(report("PENDING"), "intent");
    case "CHECK_TODAY_COLLECTION":
      return need(report("COLLECTIONS") && u.report?.period === "TODAY", "intent");
    case "CHECK_EXPENSES":
      return need(report("EXPENSES"), "intent");
    case "CHECK_PROFIT":
      return need(report("PROFIT"), "intent");
    case "CHECK_LOSS":
      return need(report("LOSS"), "intent");
    case "CHECK_CASH_BALANCE":
      return need(report("CASH"), "intent");
    case "CHECK_STOCK":
      return need(u.intent === "STOCK" || u.intent === "LOW_STOCK" || report("STOCK"), "intent");
    case "ADD_CUSTOMER":
      return need(u.intent === "HOW_TO" && u.howTo === "CUSTOMER", "intent");
    case "ADD_SUPPLIER":
      return need(u.intent === "HOW_TO" && u.howTo === "SUPPLIER", "intent");
    case "EDIT_ENTRY":
      return need(u.intent === "HOW_TO" && u.howTo === "EDIT", "intent");
    case "DELETE_ENTRY":
      return need(u.intent === "HOW_TO" && u.howTo === "DELETE", "intent");
    default:
      // CLARIFY_*: questions Kai asks; said by the owner they must never become an entry.
      return need(!(WRITES.has(u.intent) && u.amount !== undefined), "wrote an entry");
  }
}

const TOPIC_WORDS: [RegExp, string][] = [
  [/customer outstanding balance|credit receivable/, "TOTAL_RECEIVABLE"],
  [/supplier outstanding balance|amount payable/, "TOTAL_PAYABLE"],
  [/cash balance/, "CASH"],
  [/cash received|collection details/, "COLLECTIONS"],
  [/payment made/, "PAYMENTS_MADE"],
  [/sales details/, "SALES"],
  [/purchase details/, "PURCHASES"],
  [/expense details/, "EXPENSES"],
  [/profit details/, "PROFIT"],
  [/loss details/, "LOSS"],
  [/stock details/, "STOCK"],
  [/transaction history|account entries/, "HISTORY"],
  [/customer list/, "CUSTOMERS"],
  [/supplier list/, "SUPPLIERS"],
  [/today's report|monthly report/, "SUMMARY"],
];

function topicOf(u: Understanding): string {
  return u.intent === "REPORT" ? `${u.report!.topic}/${u.report!.period}` : u.intent;
}

export function scoreDataset(
  rows: DatasetRow[],
  kind: "intents" | "topics",
  parties: PartyRef[] = [],
  options: { judgeAllByWords?: boolean } = {},
): DatasetReport {
  const langs = ["th", "ta", "en"] as const;
  const byLang: DatasetReport["byLang"] = { th: { ok: 0, total: 0 }, ta: { ok: 0, total: 0 }, en: { ok: 0, total: 0 } };
  const failures: DatasetReport["failures"] = [];
  let same = 0;
  let lines = 0;
  // In a "topics" file only the sentences that carry many labels are judged by their words; a sentence with one label
  // (the hand-written seed lines) is judged by that label.
  const labels = new Map<string, Set<string>>();
  if (kind === "topics") for (const r of rows) (labels.get(r.en) ?? labels.set(r.en, new Set()).get(r.en)!).add(r.intent);
  for (const row of rows) {
    const byWords = kind === "topics" && (options.judgeAllByWords === true || (labels.get(row.en)?.size ?? 0) > 1);
    const want = byWords ? TOPIC_WORDS.find(([re]) => re.test(row.en))?.[1] : row.intent;
    if (!want) continue;
    lines++;
    const res = {} as Record<(typeof langs)[number], Understanding>;
    for (const lang of langs) {
      const u = understand({ text: row[lang], parties, products: [] });
      res[lang] = u;
      const why = byWords ? (topicOf(u).split("/")[0] === want ? null : "topic") : checkIntent(row, u, parties);
      byLang[lang].total++;
      if (!why) byLang[lang].ok++;
      else if (failures.length < 200) failures.push({ lang, intent: row.intent, text: row[lang], why, got: `${topicOf(u)} ${nameOf(u)} ${u.amount ?? ""}`.trim() });
    }
    const a = res.th;
    const b = res.ta;
    const nameA = nameOf(a);
    const nameB = nameOf(b);
    if (
      topicOf(a) === topicOf(b) &&
      a.amount === b.amount &&
      a.direction === b.direction &&
      a.howTo === b.howTo &&
      (nameA === nameB || (nameA !== "" && nameB !== "" && sameName(nameA, nameB)))
    ) {
      same++;
    }
  }
  return { lines, byLang, sameTypedAndMic: same, failures };
}
