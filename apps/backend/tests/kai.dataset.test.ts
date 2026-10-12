import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { scoreDataset, type DatasetRow } from "../src/kai/eval/datasetEval";
import { understand } from "../src/kai/intent";
import { sameName } from "../src/kai/names";
import type { PartyRef } from "../src/kai/types";

// Samples of the owner's two datasets (12 Oct 2026). The whole files score the same with
// `npm run kai:dataset -- <file.json> [intents|topics]`.
const load = <T>(name: string): T => JSON.parse(readFileSync(path.join(__dirname, "fixtures", name), "utf8")) as T;
const local = load<DatasetRow[]>("kai-dataset-local-sample.json");
const reports = load<DatasetRow[]>("kai-dataset-report-sample.json");

const NAMES = ["Kumar", "Ravi", "Murugan", "Saravanan", "Prabhu", "Karthik", "Vijay", "Arun", "Mani", "Selvam", "Raja", "Meena", "Latha", "Suresh", "Bala", "Kannan", "Satheesh", "Dinesh", "Yuvaraj", "Prakash"];
const customers: PartyRef[] = NAMES.map((name, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name, kind: "CUSTOMER" }));

function expectPerfect(report: ReturnType<typeof scoreDataset>) {
  expect(report.failures).toEqual([]);
  for (const r of Object.values(report.byLang)) expect(r.ok).toBe(r.total);
  expect(report.sameTypedAndMic).toBe(report.lines);
}

describe("KAI on the owner's ledger dataset (Kai_Local_Tamil_Thanglish_100000)", () => {
  it("reads every line typed, as the mic writes it in Tamil, and in English — people not in the books yet", () => {
    const report = scoreDataset(local, "intents");
    expect(report.lines).toBeGreaterThan(800);
    expectPerfect(report);
  });

  it("the same lines when the people are the shop's customers", () => {
    expectPerfect(scoreDataset(local, "intents", customers));
  });

  it("the same lines typed all in lower case (how owners really type)", () => {
    const lower = local.map((r) => ({ ...r, th: r.th.toLowerCase(), en: r.en.toLowerCase() }));
    expectPerfect(scoreDataset(lower, "intents"));
  });
});

describe("KAI on the owner's report dataset (Kai_100000_Dataset)", () => {
  it("answers the topic the sentence names, the same in Tanglish, Tamil and English (its labels are not usable)", () => {
    const report = scoreDataset(reports, "topics", [], { judgeAllByWords: true });
    expect(report.lines).toBeGreaterThan(300);
    expectPerfect(report);
  });
});

describe("KAI on the Android Kai's owner lines (owner-lines.txt ENTRY lines)", () => {
  const parties: PartyRef[] = [
    ...["Kumar", "Ramesh", "Selvam", "Lakshmi"].map((name, i) => ({ id: `c${i}`, name, kind: "CUSTOMER" as const })),
    ...["ABC Traders", "Murugan Stores"].map((name, i) => ({ id: `s${i}`, name, kind: "SUPPLIER" as const })),
  ];
  const entries = load<{ said: string; kind: string; name: string; amount: number }[]>("kai-owner-entries.json");
  const intentOf: Record<string, string> = { IN: "RECORD_PAYMENT", OUT: "RECORD_PAYMENT", CREDIT: "ADD_CREDIT", DEBIT: "ADD_DEBIT" };

  it.each(entries)("$said → $kind $name $amount", ({ said, kind, name, amount }) => {
    const u = understand({ text: said, parties, products: [] });
    const got = u.party.status === "FOUND" ? u.party.party.name : u.party.status === "UNKNOWN" ? u.party.said : "";
    expect(u.intent).toBe(intentOf[kind]);
    expect(u.amount).toBe(amount);
    expect(sameName(got, name)).toBe(true);
  });
});
