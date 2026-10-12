import { understand } from "../intent";
import type { KaiTurnContext } from "../types";
import { EVAL_PARTIES, EVAL_PRODUCTS, GOLDEN_SET, type EvalCase } from "./goldenSet";

export interface EvalFailure {
  case: EvalCase;
  got: { intent: string; party?: string; amount?: number; product?: string };
}

export interface EvalReport {
  total: number;
  passed: number;
  accuracy: number;
  failures: EvalFailure[];
}

function partyLabel(u: ReturnType<typeof understand>): string | undefined {
  const p = u.party;
  if (p.status === "FOUND") return p.party.name;
  if (p.status === "AMBIGUOUS") return "?";
  if (p.status === "UNKNOWN") return `!${p.said}`;
  return undefined;
}

/** Runs the rule-based understanding over the golden set (no database, no model). */
export function runIntentEval(cases: EvalCase[] = GOLDEN_SET): EvalReport {
  const failures: EvalFailure[] = [];
  for (const c of cases) {
    const last = c.lastParty ? EVAL_PARTIES.find((p) => p.name === c.lastParty) : undefined;
    const turn: KaiTurnContext = last ? { lastParty: last } : {};
    const u = understand({ text: c.text, parties: EVAL_PARTIES, products: EVAL_PRODUCTS, turn });
    const got = {
      intent: u.intent,
      party: partyLabel(u),
      amount: u.amount,
      product: u.product.status === "FOUND" ? u.product.product.name : undefined,
    };
    const ok =
      got.intent === c.intent &&
      (c.party === undefined || got.party === c.party) &&
      (c.amount === undefined || got.amount === c.amount) &&
      (c.product === undefined || got.product === c.product);
    if (!ok) failures.push({ case: c, got });
  }
  const passed = cases.length - failures.length;
  return { total: cases.length, passed, accuracy: cases.length ? passed / cases.length : 1, failures };
}
