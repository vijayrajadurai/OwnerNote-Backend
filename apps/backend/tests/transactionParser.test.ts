import { describe, expect, it } from "vitest";
import { parseTransactionText } from "../src/ai/transactionParser";

const NOW = new Date("2026-09-11T10:00:00.000Z");

describe("parseTransactionText", () => {
  it("parses a Tanglish credit entry with a customer, amount, and ordinal due date", () => {
    const result = parseTransactionText(
      "Kumar-ku 2000-ku product supply panniruken. 7th date 2000 tharanum.",
      NOW,
    );
    expect(result.intent).toBe("CREATE_CREDIT");
    expect(result.partyName).toBe("Kumar");
    expect(result.amount).toBe(2000);
    expect(result.dueDate).not.toBeNull();
    expect(new Date(result.dueDate!).getUTCDate()).toBe(7);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("parses a Tanglish debit entry with a supplier, currency amount, and ordinal due date", () => {
    const result = parseTransactionText(
      "Murugan Traders-kitta ₹15,000-ku product vaangiruken. 10th date payment.",
      NOW,
    );
    expect(result.intent).toBe("CREATE_DEBIT");
    expect(result.partyName).toBe("Murugan Traders");
    expect(result.amount).toBe(15000);
    expect(new Date(result.dueDate!).getUTCDate()).toBe(10);
  });

  it("parses a plain English credit entry", () => {
    const result = parseTransactionText("Ravi-ku 5000 credit.", NOW);
    expect(result.intent).toBe("CREATE_CREDIT");
    expect(result.partyName).toBe("Ravi");
    expect(result.amount).toBe(5000);
  });

  it("treats '-kitta ... vaanganum' as credit, not debit, despite the 'kitta' particle", () => {
    const result = parseTransactionText("Ravi-kitta 5000 vaanganum.", NOW);
    expect(result.intent).toBe("CREATE_CREDIT");
    expect(result.partyName).toBe("Ravi");
    expect(result.amount).toBe(5000);
  });

  it("parses a debit entry with a relative weekday due date", () => {
    const result = parseTransactionText("ABC Traders-kitta 20,000 payment next Friday.", NOW);
    expect(result.intent).toBe("CREATE_DEBIT");
    expect(result.partyName).toBe("ABC Traders");
    expect(result.amount).toBe(20000);
    expect(result.dueDate).not.toBeNull();
    expect(new Date(result.dueDate!).getUTCDay()).toBe(5); // Friday
    expect(new Date(result.dueDate!).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("recognizes a cash sale without a party name", () => {
    const result = parseTransactionText("Today 10,000 cash sale.", NOW);
    expect(result.intent).toBe("CASH_SALE");
    expect(result.partyName).toBeNull();
    expect(result.amount).toBe(10000);
  });

  it("handles k/lakh amount shorthand", () => {
    expect(parseTransactionText("Kumar-ku 5k credit", NOW).amount).toBe(5000);
    expect(parseTransactionText("Kumar-ku 2 lakh credit", NOW).amount).toBe(200000);
  });

  it("returns UNKNOWN with low confidence for unrelated text", () => {
    const result = parseTransactionText("Shop-a clean pannunga please", NOW);
    expect(result.intent).toBe("UNKNOWN");
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("classifies a Tamil balance question as ASK_QUERY with party name", () => {
    const result = parseTransactionText("குமார் எனக்கு எவ்வளவு தரணும்?", NOW);
    expect(result.intent).toBe("ASK_QUERY");
    expect(result.partyName).toBe("குமார்");
    expect(result.amount).toBeNull();
  });

  it("always returns the original text unmodified as rawText", () => {
    const text = "Ravi-ku 5000 credit.";
    expect(parseTransactionText(text, NOW).rawText).toBe(text);
  });
});
