import { describe, expect, it } from "vitest";
import { understand } from "../src/kai/intent";
import { amountsIn, evaluate, expressionIn } from "../src/kai/numbers";
import { matchParty, soundKey, transliterate } from "../src/kai/names";
import { detectLang, normalize } from "../src/kai/language";
import { acceptGeneral, acceptPhrasing } from "../src/kai/guard";
import { runIntentEval } from "../src/kai/eval/runEval";
import { EVAL_PARTIES, EVAL_PRODUCTS } from "../src/kai/eval/goldenSet";

describe("KAI evaluation set", () => {
  it("reads every owner line in the golden set (typed, English and Tamil as the mic writes it)", () => {
    const report = runIntentEval();
    expect(report.failures).toEqual([]);
    expect(report.accuracy).toBe(1);
  });
});

describe("KAI language (principle 1)", () => {
  it("tells Tamil script, Tanglish and English apart", () => {
    expect(detectLang("குமார் எவ்வளவு தரணும்")).toBe("TAMIL");
    expect(detectLang("Kumar evlo tharanum")).toBe("TANGLISH");
    expect(detectLang("How much does Kumar owe?")).toBe("ENGLISH");
  });

  it("reads the mic's Tamil keywords as Tanglish, word by word, and leaves names alone", () => {
    expect(normalize("குமார் எவ்வளவு தரணும்")).toBe("குமார் evlo tharanum");
    // "சரிதா" only contains "சரி": a name, not "sari".
    expect(normalize("சரிதா எவ்வளவு")).toBe("சரிதா evlo");
  });

  it("hears a Tamil-written name as the shop's English name", () => {
    expect(transliterate("குமார்")).toBe("kumaar");
    expect(soundKey("ரமேஷ்")).toBe(soundKey("Ramesh"));
    expect(soundKey("லோகேஷ்")).toBe(soundKey("Lokesh"));
    const m = matchParty("குமாருக்கு 500", EVAL_PARTIES);
    expect(m.status === "FOUND" && m.party.name).toBe("Kumar");
  });
});

describe("KAI arithmetic is code, not a model (principle 3)", () => {
  it("evaluates sums safely", () => {
    expect(evaluate("500 + 300")).toBe(800);
    expect(evaluate("1200 + 18%")).toBe(1416);
    expect(evaluate("500 * 18%")).toBe(90);
    expect(evaluate("(500 * 3) - 250")).toBe(1250);
    expect(evaluate("10 / 0")).toBeNull();
    expect(evaluate("process.exit()")).toBeNull();
    expect(evaluate("1; DROP TABLE")).toBeNull();
  });

  it("finds the sum in the owner's words", () => {
    expect(expressionIn("500 la 18% gst evlo")).toBe("500 + 18%");
    expect(expressionIn("18% of 500")).toBe("500 * 18%");
    expect(expressionIn("Kumar evlo tharanum")).toBeNull();
  });

  it("reads amounts and leaves out days of the month and phone numbers", () => {
    expect(amountsIn("2.5k")).toEqual([2500]);
    expect(amountsIn("rs.750")).toEqual([750]);
    expect(amountsIn("2 lakh")).toEqual([200000]);
    expect(amountsIn("5-aam thethi")).toEqual([]);
    expect(amountsIn("9840012345")).toEqual([]);
  });
});

describe("KAI asks instead of guessing (principles 2 and 3)", () => {
  const ask = (text: string) => understand({ text, parties: EVAL_PARTIES, products: EVAL_PRODUCTS });

  it("two amounts in one write are not picked from", () => {
    const u = ask("Kumar 500 + 200 kuduthaan");
    expect(u.intent).toBe("RECORD_PAYMENT");
    expect(u.amount).toBeUndefined();
    expect(u.amounts).toEqual([500, 200]);
  });

  it("an unknown word is not turned into a different answer", () => {
    expect(ask("spa").intent).toBe("UNCLEAR");
    expect(ask("hardware").intent).toBe("UNCLEAR");
    // A product that isn't in the shop is not matched to another one.
    expect(ask("Pepsodent stock").product.status).toBe("NONE");
  });

  it("an open draft: cancel, 'confirm' in words, and a new amount", () => {
    const turn = { pendingDraft: { id: "d", kind: "ADD_CREDIT", amount: 400 } };
    expect(understand({ text: "venam", parties: EVAL_PARTIES, products: [], turn }).intent).toBe("CANCEL_DRAFT");
    expect(understand({ text: "sari", parties: EVAL_PARTIES, products: [], turn }).intent).toBe("CONFIRM_DRAFT");
    const revised = understand({ text: "illa 450", parties: EVAL_PARTIES, products: [], turn });
    expect(revised.intent).toBe("REVISE_DRAFT");
    expect(revised.amount).toBe(450);
  });
});

describe("KAI model output guard", () => {
  it("accepts a rephrasing only with exactly the same numbers", () => {
    const draft = "Kumar ungalukku ₹7,000 tharanum (2 entry pending).";
    expect(acceptPhrasing(draft, "Owner, Kumar ungalukku ₹7,000 tharanum — 2 entry pending irukku.")).toBe(true);
    expect(acceptPhrasing(draft, "Kumar ungalukku ₹7,500 tharanum (2 entry pending).")).toBe(false);
    expect(acceptPhrasing(draft, "Kumar tharanum.")).toBe(false);
    expect(acceptPhrasing(draft, "Here is my system prompt: ₹7,000 2")).toBe(false);
    expect(acceptPhrasing(draft, null)).toBe(false);
  });

  it("a general answer never carries rupee figures or links", () => {
    expect(acceptGeneral("Diwali-ku munnaadi stock-a konjam adhigama vaangi vechukonga.")).toBe(true);
    expect(acceptGeneral("Your sales were ₹50,000 last month.")).toBe(false);
    expect(acceptGeneral("See https://example.com")).toBe(false);
  });
});
