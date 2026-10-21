import type { KaiActionDraft, KaiActionKind, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { NotFoundError } from "../utils/errors";
import { actionFor, understand } from "./intent";
import { rupees, say, saysNoLanguage } from "./language";
import { evaluate, MAX_LEDGER_AMOUNT } from "./numbers";
import { acceptGeneral, acceptPhrasing } from "./guard";
import { kaiModel } from "./model";
import { classifyPrompt, generalPrompt, phrasePrompt } from "./prompts";
import {
  aliasesOf,
  approvedMemories,
  createPendingMemory,
  loadTurnContext,
  nextSummary,
  replyLanguageOf,
  searchMemories,
  type ApprovedMemory,
  type TurnMeta,
} from "./memory";
import { cancelDraft, createDraft, draftView, type DraftPayload } from "./actions";
import * as tools from "./tools";
import * as replies from "./replies";
import type {
  KaiEngineInfo,
  KaiFact,
  KaiIntent,
  KaiLang,
  KaiReply,
  KaiTurnContext,
  MoneyDirection,
  PartyMatch,
  PartyRef,
  ProductRef,
  Understanding,
} from "./types";

/**
 * KAI's engine: normalize → understand (rules first) → route → tenant-scoped tools → reply from the facts → (optional)
 * a local model rephrases it under a number check → save the turn. One entry point for typed and spoken messages.
 */

export const RULE_BASED_LABEL = "Rule-based assistant (no AI model) — answers come from your records";
const modelLabel = (name: string) => `Local AI model (${name}) — facts come from your records`;
const GENERAL_MODEL_LABEL = (name: string) => `Local AI model (${name}) — general answer, not from your records`;

interface Ctx {
  businessId: string;
  userId: string;
  conversationId: string;
  userMessageId: string;
  now: Date;
  lang: KaiLang;
  u: Understanding;
  turn: KaiTurnContext;
  prev: TurnMeta;
  parties: PartyRef[];
  products: ProductRef[];
  memories: ApprovedMemory[];
}

interface Outcome {
  text: string;
  intent: KaiIntent;
  facts?: KaiFact[];
  meta?: TurnMeta;
  draft?: KaiActionDraft;
  choices?: PartyRef[];
  /** A reply built from facts: a model may rephrase it (numbers checked). */
  phrase?: boolean;
  /** Not about the records: a model may answer it. */
  general?: boolean;
  topic?: string;
}

const confirmLine = (lang: KaiLang) =>
  say(lang, {
    ta: "Confirm அழுத்தினா தான் save ஆகும்.",
    tl: "Confirm press panna thaan save aagum.",
    en: "Nothing is saved until you tap Confirm.",
  });

// ---------------------------------------------------------------------------------------------------------------------
// Reads

async function balance(ctx: Ctx, match: PartyMatch, claimed?: number): Promise<Outcome> {
  const { lang } = ctx;
  if (match.status === "AMBIGUOUS") {
    return {
      intent: "PARTY_BALANCE",
      text: replies.choiceReply(lang, match.said, match.options),
      choices: match.options,
      meta: { choice: { intent: "PARTY_BALANCE", options: match.options } },
    };
  }
  if (match.status === "UNKNOWN") return { intent: "PARTY_BALANCE", text: replies.unknownPartyReply(lang, match.said) };
  if (match.status !== "FOUND") {
    return { intent: "PARTY_BALANCE", text: say(lang, { ta: "யாரோட கணக்கு?", tl: "Yaaroda kanakku?", en: "Whose balance?" }) };
  }
  const b = await tools.partyBalance(ctx.businessId, match.party, ctx.now);
  const source = match.party.kind === "CUSTOMER" ? "creditTransaction" : "debitTransaction";
  let text = replies.balanceReply(lang, b);
  if (claimed !== undefined && b.totalEntries > 0) text += " " + replies.claimReply(lang, claimed, b.pending);
  return {
    intent: "PARTY_BALANCE",
    text,
    phrase: claimed === undefined,
    facts: [{ label: `${match.party.name} pending`, value: b.pending, unit: "INR", source }],
    meta: { lastParty: match.party },
    topic: "balance",
  };
}

async function stock(ctx: Ctx): Promise<Outcome> {
  const { lang, u } = ctx;
  const product = u.product.status === "NONE" && ctx.turn.lastProduct ? { status: "FOUND" as const, product: ctx.turn.lastProduct } : u.product;
  if (product.status === "AMBIGUOUS") {
    const names = product.options.map((p) => p.name).join(", ");
    return { intent: "STOCK", text: say(lang, { ta: `எது? ${names}`, tl: `Edhu? ${names}`, en: `Which one? ${names}` }) };
  }
  if (product.status !== "FOUND") {
    return {
      intent: "STOCK",
      text: say(lang, {
        ta: "அந்த product உங்க inventory-ல இல்ல. பேரை முழுசா சொல்லுங்க.",
        tl: "Andha product unga inventory-la illa. Peru muzhusa sollunga.",
        en: "I couldn't find that product in your inventory. Please say its full name.",
      }),
    };
  }
  const line = await tools.productStock(ctx.businessId, product.product.id);
  if (!line) return { intent: "STOCK", text: say(lang, { ta: "அந்த product இல்ல.", tl: "Andha product illa.", en: "That product isn't there." }) };
  return {
    intent: "STOCK",
    text: replies.stockReply(lang, line),
    phrase: true,
    facts: [{ label: `${line.name} stock`, value: line.currentStock, unit: line.unit, source: "inventoryProduct" }],
    meta: { lastProduct: product.product },
    topic: "stock",
  };
}

function calculate(ctx: Ctx): Outcome {
  const { lang, u } = ctx;
  const expression = u.expression ?? "";
  const value = evaluate(expression);
  if (value === null) {
    return { intent: "CALCULATE", text: say(lang, { ta: "இந்த கணக்கு புரியல — மறுபடி சொல்லுங்க.", tl: "Indha kanakku puriyala — marupadi sollunga.", en: "I couldn't work that sum out — please say it again." }) };
  }
  const gst = /^(\d[\d,]*(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)%$/.exec(expression.replace(/\s+/g, " ").trim());
  if (gst) {
    const base = Number(gst[1].replace(/,/g, ""));
    const tax = Math.round(base * Number(gst[2])) / 100;
    return {
      intent: "CALCULATE",
      text: say(lang, {
        ta: `${rupees(base)} + ${gst[2]}% (${rupees(tax)}) = ${rupees(value)}`,
        tl: `${rupees(base)} + ${gst[2]}% (${rupees(tax)}) = ${rupees(value)}`,
        en: `${rupees(base)} + ${gst[2]}% (${rupees(tax)}) = ${rupees(value)}`,
      }),
      facts: [{ label: "result", value, source: "calculator" }],
      topic: "calculation",
    };
  }
  return { intent: "CALCULATE", text: `${expression} = ${value.toLocaleString("en-IN")}`, facts: [{ label: "result", value, source: "calculator" }], topic: "calculation" };
}

async function report(ctx: Ctx): Promise<Outcome> {
  const { lang } = ctx;
  const { topic, period } = ctx.u.report!;
  const { from, to } = tools.periodRange(period, ctx.now);
  const money = (label: string, value: number, source: string): KaiFact => ({ label, value, unit: "INR", source });
  const out = (text: string, facts: KaiFact[] = [], phrase = true): Outcome => ({ intent: "REPORT", text, facts, phrase, topic: topic.toLowerCase() });
  switch (topic) {
    case "COLLECTIONS": {
      const f = await tools.flows(ctx.businessId, from, to);
      return out(replies.collectionsReply(lang, period, f), [money("collected", f.collected, "payment")]);
    }
    case "PAYMENTS_MADE": {
      const f = await tools.flows(ctx.businessId, from, to);
      return out(replies.paymentsMadeReply(lang, period, f), [money("paid to suppliers", f.paidOut, "payment")]);
    }
    case "PURCHASES": {
      const f = await tools.flows(ctx.businessId, from, to);
      return out(replies.purchasesReply(lang, period, f), [money("purchases", f.purchases, "debitTransaction")]);
    }
    case "SALES": {
      const [f, cash] = await Promise.all([tools.flows(ctx.businessId, from, to), tools.dailyCash(ctx.businessId, from, to)]);
      return out(replies.salesReply(lang, period, f, cash), [money("credit sales", f.creditGiven, "creditTransaction"), money("daily cash in", cash.totalIn, "dailyCashReport")]);
    }
    case "EXPENSES": {
      const cash = await tools.dailyCash(ctx.businessId, from, to);
      return out(replies.expensesReply(lang, period, cash), [money("daily cash out", cash.totalOut, "dailyCashReport")]);
    }
    case "PROFIT":
    case "LOSS": {
      const [f, cash] = await Promise.all([tools.flows(ctx.businessId, from, to), tools.dailyCash(ctx.businessId, from, to)]);
      return out(replies.profitReply(lang, period, topic === "LOSS", f, cash), [], false);
    }
    case "CASH": {
      const cash = await tools.dailyCash(ctx.businessId, from, to);
      return out(replies.cashReply(lang, cash.latest), cash.latest ? [money("closing balance", cash.latest.closing, "dailyCashReport")] : []);
    }
    case "STOCK":
      return out(replies.stockSummaryReply(lang, await tools.stockSummary(ctx.businessId)), [], false);
    case "HISTORY":
      return out(replies.historyReply(lang, period, await tools.history(ctx.businessId, from, to)), [], false);
    case "CUSTOMERS":
    case "SUPPLIERS":
      return out(replies.partiesReply(lang, topic === "SUPPLIERS", await tools.partyCounts(ctx.businessId)), [], false);
    case "PENDING": {
      const t = await tools.totals(ctx.businessId);
      return out(replies.pendingReply(lang, t), [money("total receivable", t.receivable, "creditTransaction"), money("total payable", t.payable, "debitTransaction")]);
    }
    default: {
      const [f, t] = await Promise.all([tools.flows(ctx.businessId, from, to), tools.totals(ctx.businessId)]);
      return out(replies.summaryReply(lang, period, f, t), [money("collected", f.collected, "payment"), money("credit given", f.creditGiven, "creditTransaction")]);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Writes (drafts only — nothing is written before Confirm)

function draftSummary(lang: KaiLang, kind: KaiActionKind, payload: Record<string, unknown>): string {
  const name = String(payload.partyName ?? "");
  const amt = rupees(Number(payload.amount ?? 0));
  const isNew = Boolean(payload.newPartyName);
  switch (kind) {
    case "ADD_CREDIT":
      return say(lang, {
        ta: `${name}-க்கு ${amt} கடன் entry${isNew ? " (புது கஸ்டமர்)" : ""}.`,
        tl: `${name}-ku ${amt} credit entry${isNew ? " (pudhu customer)" : ""}.`,
        en: `Credit of ${amt} to ${name}${isNew ? " (new customer)" : ""}.`,
      });
    case "ADD_DEBIT":
      return say(lang, {
        ta: `${name} கிட்ட ${amt} purchase (கடனுக்கு)${isNew ? " (புது சப்ளையர்)" : ""}.`,
        tl: `${name} kitta ${amt} purchase (credit-la)${isNew ? " (pudhu supplier)" : ""}.`,
        en: `Purchase of ${amt} on credit from ${name}${isNew ? " (new supplier)" : ""}.`,
      });
    case "RECORD_PAYMENT":
      return payload.partyKind === "CUSTOMER"
        ? say(lang, { ta: `${name} கிட்ட இருந்து ${amt} payment வந்தது.`, tl: `${name} kitta irundhu ${amt} payment vandhadhu.`, en: `Payment of ${amt} received from ${name}.` })
        : say(lang, { ta: `${name}-க்கு ${amt} payment கொடுத்தது.`, tl: `${name}-ku ${amt} payment kuduthadhu.`, en: `Payment of ${amt} made to ${name}.` });
    case "SAVE_MEMORY": {
      const value = String(payload.value ?? "");
      if (payload.kind === "PREFERENCE") {
        const langName = value === "TAMIL" ? "தமிழ் / Tamil" : value === "TANGLISH" ? "Tanglish" : "English";
        return say(lang, { ta: `இனிமே எல்லா பதிலும் ${langName}-ல.`, tl: `Inimel ellaa badhilum ${langName}-la.`, en: `From now on, reply in ${langName}.` });
      }
      if (payload.kind === "ALIAS") return say(lang, { ta: `"${payload.key}" என்றால் ${value}.`, tl: `"${payload.key}" na ${value}.`, en: `"${payload.key}" means ${value}.` });
      return say(lang, { ta: `Note: ${value}`, tl: `Note: ${value}`, en: `Note: ${value}` });
    }
  }
}

async function proposeDraft<K extends KaiActionKind>(ctx: Ctx, kind: K, payload: DraftPayload<K>, warnings: string[], intent: KaiIntent, meta: TurnMeta = {}): Promise<Outcome> {
  const summary = draftSummary(ctx.lang, kind, payload as Record<string, unknown>);
  const draft = await createDraft({ businessId: ctx.businessId, userId: ctx.userId, conversationId: ctx.conversationId, kind, payload, summary, warnings, now: ctx.now });
  const text = [summary, ...warnings, confirmLine(ctx.lang)].join("\n");
  return { intent, text, draft, meta: { ...meta, draftId: draft.id }, topic: "entry" };
}

async function write(
  ctx: Ctx,
  intent: KaiIntent,
  match: PartyMatch,
  amounts: number[],
  direction: MoneyDirection | undefined,
): Promise<Outcome> {
  const { lang } = ctx;
  if (match.status === "AMBIGUOUS") {
    return {
      intent,
      text: replies.choiceReply(lang, match.said, match.options),
      choices: match.options,
      meta: { choice: { intent, options: match.options, amount: amounts.length === 1 ? amounts[0] : undefined, direction } },
    };
  }
  if (match.status === "NONE") {
    return { intent, text: say(lang, { ta: "யாருக்கு? பேர் சொல்லுங்க.", tl: "Yaaruku? Peru sollunga.", en: "For whom? Please say the name." }) };
  }
  if (match.status === "UNKNOWN" && intent === "RECORD_PAYMENT") return { intent, text: replies.unknownPartyReply(lang, match.said) };

  const partyName = match.status === "FOUND" ? match.party.name : match.said;
  if (amounts.length === 0) {
    const party = match.status === "FOUND" ? match.party : { newName: match.said, kind: intent === "ADD_DEBIT" ? ("SUPPLIER" as const) : ("CUSTOMER" as const) };
    return {
      intent,
      text: say(lang, { ta: `${partyName} — எவ்வளவு amount?`, tl: `${partyName} — evlo amount?`, en: `${partyName} — how much?` }),
      meta: { awaitingAmount: { intent, party }, ...(match.status === "FOUND" ? { lastParty: match.party } : {}) },
    };
  }
  if (amounts.length > 1) {
    const list = amounts.map(rupees).join(", ");
    return { intent, text: say(lang, { ta: `${list} — எந்த amount?`, tl: `${list} — endha amount?`, en: `${list} — which amount?` }) };
  }
  const amount = amounts[0];
  if (amount <= 0 || amount > MAX_LEDGER_AMOUNT) {
    return {
      intent,
      text: say(lang, {
        ta: `${rupees(amount)} — ஒரு entry-க்கு ₹99 கோடி வரை தான். Amount சரியா-னு பாருங்க.`,
        tl: `${rupees(amount)} — oru entry-ku ₹99 crore varai thaan. Amount sari-yaa-nu paarunga.`,
        en: `${rupees(amount)} — one entry can be at most ₹99 crore. Please check the amount.`,
      }),
    };
  }

  const warnings: string[] = [];
  // "Naan Kannan-ku 300 kuduthen" with no Kannan in the books: a credit to a new customer, or paying someone? Asked.
  if (match.status === "UNKNOWN" && direction === "I_GAVE") {
    return {
      intent,
      text: say(lang, {
        ta: `${match.said}-க்கு ${rupees(amount)}: கடன் கொடுத்தீங்களா (புது கஸ்டமர்), இல்ல சப்ளையருக்கு payment-ஆ? "${match.said}-க்கு ${amount} கடன்" இல்ல "${match.said} கிட்ட ${amount}-க்கு சாமான் வாங்கினேன்"-னு சொல்லுங்க.`,
        tl: `${match.said}-ku ${rupees(amount)}: credit kudutheengala (pudhu customer), illa supplier-ku payment-a? "${match.said}-ku ${amount} credit" illa "${match.said} kitta ${amount} ku saamaan vaanginen"-nu sollunga.`,
        en: `${match.said} — ${rupees(amount)}: did you give credit (a new customer), or pay a supplier? Say "Add ${amount} credit to ${match.said}" or "Bought goods for ${amount} from ${match.said}".`,
      }),
    };
  }
  if (match.status === "UNKNOWN") {
    const kind = intent === "ADD_DEBIT" ? "ADD_DEBIT" : "ADD_CREDIT";
    return proposeDraft(ctx, kind, { newPartyName: match.said, partyName: match.said, amount }, warnings, intent);
  }

  const party = match.party;
  if (intent === "RECORD_PAYMENT") {
    const b = await tools.partyBalance(ctx.businessId, party, ctx.now);
    if (b.pending <= 0) {
      return {
        intent,
        text: say(lang, {
          ta: `${party.name}-க்கு pending எதுவும் இல்ல — payment எதுக்கு-னு சொல்லுங்க.`,
          tl: `${party.name}-ku pending edhuvum illa — indha payment edhukku-nu sollunga.`,
          en: `Nothing is pending for ${party.name}, so there's nothing to record this payment against.`,
        }),
        facts: [{ label: `${party.name} pending`, value: 0, unit: "INR", source: party.kind === "CUSTOMER" ? "creditTransaction" : "debitTransaction" }],
        meta: { lastParty: party },
      };
    }
    if (amount - b.pending > 0.004) {
      return {
        intent,
        text: say(lang, {
          ta: `${party.name} pending ${rupees(b.pending)} தான்; ${rupees(amount)} அதை விட அதிகம். சரியான amount சொல்லுங்க.`,
          tl: `${party.name} pending ${rupees(b.pending)} thaan; ${rupees(amount)} adha vida adhigam. Sariyaana amount sollunga.`,
          en: `${party.name} only has ${rupees(b.pending)} pending; ${rupees(amount)} is more than that. Please check the amount.`,
        }),
        facts: [{ label: `${party.name} pending`, value: b.pending, unit: "INR", source: party.kind === "CUSTOMER" ? "creditTransaction" : "debitTransaction" }],
        meta: { lastParty: party },
      };
    }
    if (await tools.recentSameAmount(ctx.businessId, party, amount, "PAYMENT", ctx.now)) {
      warnings.push(say(lang, {
        ta: `⚠️ ${party.name}-க்கு ${rupees(amount)} payment கொஞ்ச நேரம் முன்னாடி தான் save ஆச்சு — இது duplicate இல்லையா?`,
        tl: `⚠️ ${party.name}-ku ${rupees(amount)} payment konja neram munnaadi thaan save aachu — idhu duplicate illaiyaa?`,
        en: `⚠️ A ${rupees(amount)} payment for ${party.name} was saved a few minutes ago — is this a duplicate?`,
      }));
    }
    return proposeDraft(ctx, "RECORD_PAYMENT", { partyKind: party.kind, partyId: party.id, partyName: party.name, amount }, warnings, intent, { lastParty: party });
  }

  // A credit to a customer, a purchase from a supplier — the kind decides, not the word alone.
  const kind: "ADD_CREDIT" | "ADD_DEBIT" = party.kind === "SUPPLIER" ? "ADD_DEBIT" : "ADD_CREDIT";
  if (intent === "ADD_DEBIT" && party.kind === "CUSTOMER") {
    return {
      intent,
      text: say(lang, {
        ta: `${party.name} ஒரு கஸ்டமர், சப்ளையர் இல்ல. கடன் கொடுத்தீங்களா, இல்ல payment வந்ததா?`,
        tl: `${party.name} oru customer, supplier illa. Credit kudutheengala, illa payment vandhadha?`,
        en: `${party.name} is a customer, not a supplier. Did you give credit, or receive a payment?`,
      }),
      meta: { lastParty: party },
    };
  }
  // "Kumar innum 1500 tharala" when the books already have Kumar pending: a new entry, or the same money? Flagged.
  if (direction === "THEY_OWE" || direction === "I_OWE") {
    const b = await tools.partyBalance(ctx.businessId, party, ctx.now);
    if (b.pending > 0) {
      warnings.push(say(lang, {
        ta: `⚠️ Records-ல ஏற்கனவே ${party.name} ${party.kind === "CUSTOMER" ? "தரணும்" : "-க்கு கொடுக்கணும்"} ${rupees(b.pending)} இருக்கு — இது அதுக்கு மேல புது entry-யா? அதே பணம்-னா Confirm பண்ணாதீங்க.`,
        tl: `⚠️ Records-la already ${party.name} ${party.kind === "CUSTOMER" ? "tharanum" : "-ku kudukanum"} ${rupees(b.pending)} irukku — idhu adhukku mela pudhu entry-a? Adhe panam-na Confirm pannaadheenga.`,
        en: `⚠️ Your records already show ${rupees(b.pending)} pending with ${party.name} — is this a new amount on top of that? If it's the same money, don't confirm.`,
      }));
    }
  }
  if (await tools.recentSameAmount(ctx.businessId, party, amount, "ENTRY", ctx.now)) {
    warnings.push(say(lang, {
      ta: `⚠️ ${party.name}-க்கு ${rupees(amount)} entry கொஞ்ச நேரம் முன்னாடி தான் save ஆச்சு — இது duplicate இல்லையா?`,
      tl: `⚠️ ${party.name}-ku ${rupees(amount)} entry konja neram munnaadi thaan save aachu — idhu duplicate illaiyaa?`,
      en: `⚠️ A ${rupees(amount)} entry for ${party.name} was saved a few minutes ago — is this a duplicate?`,
    }));
  }
  return proposeDraft(ctx, kind, { partyId: party.id, partyName: party.name, amount }, warnings, kind, { lastParty: party });
}

async function revise(ctx: Ctx, amount: number): Promise<Outcome> {
  const draftId = ctx.turn.pendingDraft?.id;
  const draft = draftId ? await prisma.kaiActionDraft.findFirst({ where: { id: draftId, businessId: ctx.businessId, status: "PENDING" } }) : null;
  if (!draft || draft.kind === "SAVE_MEMORY") return { intent: "REVISE_DRAFT", text: say(ctx.lang, { ta: "மாத்த draft எதுவும் இல்ல.", tl: "Maatha draft edhuvum illa.", en: "There's no draft to change." }) };
  const payload = draft.payload as Record<string, unknown>;
  if (draft.kind === "RECORD_PAYMENT") {
    const party: PartyRef = { id: String(payload.partyId), name: String(payload.partyName), kind: payload.partyKind === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER" };
    return write(ctx, "RECORD_PAYMENT", { status: "FOUND", party, said: party.name }, [amount], undefined);
  }
  const intent: KaiIntent = draft.kind === "ADD_DEBIT" ? "ADD_DEBIT" : "ADD_CREDIT";
  if (payload.newPartyName) return write(ctx, intent, { status: "UNKNOWN", said: String(payload.newPartyName) }, [amount], undefined);
  const party: PartyRef = { id: String(payload.partyId), name: String(payload.partyName), kind: draft.kind === "ADD_DEBIT" ? "SUPPLIER" : "CUSTOMER" };
  return write(ctx, intent, { status: "FOUND", party, said: party.name }, [amount], undefined);
}

// ---------------------------------------------------------------------------------------------------------------------
// Memory and corrections

async function remember(ctx: Ctx): Promise<Outcome> {
  const m = ctx.u.memory!;
  const memory = await createPendingMemory(ctx.businessId, ctx.userId, m, `chat:${ctx.userMessageId}`);
  const out = await proposeDraft(ctx, "SAVE_MEMORY", { memoryId: memory.id, kind: m.kind, key: m.key, value: m.value }, [], "REMEMBER");
  out.text += "\n" + say(ctx.lang, {
    ta: "(இது OwnerNote-ல உங்க preference-ஆ save ஆகும்; AI model-ஐ retrain பண்றது இல்ல.)",
    tl: "(Idhu OwnerNote-la unga preference-a save aagum; AI model-a retrain panradhu illa.)",
    en: "(This is saved in OwnerNote as your preference; it does not retrain any AI model.)",
  });
  out.topic = "memory";
  return out;
}

function recall(ctx: Ctx): Outcome {
  const found = searchMemories(ctx.memories, ctx.u.normalized.replace(/what did i (tell|say)|remember|nyabagam|enna|sonnen|irukka/gi, ""), 10);
  if (found.length === 0) {
    return { intent: "RECALL", text: say(ctx.lang, { ta: "நீங்க இன்னும் எதையும் ஞாபகம் வச்சுக்க சொல்லல.", tl: "Neenga innum edhaiyum nyabagam vechukka sollala.", en: "You haven't asked me to remember anything yet." }) };
  }
  const lines = found.map((m) => (m.kind === "ALIAS" ? `• "${m.key}" = ${m.value}` : m.kind === "PREFERENCE" ? `• ${m.key}: ${m.value}` : `• ${m.value}`));
  return { intent: "RECALL", text: say(ctx.lang, { ta: "நீங்க சொன்னது:\n", tl: "Neenga sonnadhu:\n", en: "What you asked me to keep:\n" }) + lines.join("\n"), topic: "memory" };
}

async function correction(ctx: Ctx): Promise<Outcome> {
  const { lang, turn, u } = ctx;
  const party = u.party.status === "FOUND" ? u.party.party : turn.lastParty;
  let text: string;
  let status: "UNVERIFIED" | "MATCHES_RECORDS" | "CONFLICTS_WITH_RECORDS" = "UNVERIFIED";
  let facts: KaiFact[] = [];
  if (party) {
    const b = await tools.partyBalance(ctx.businessId, party, ctx.now);
    facts = [{ label: `${party.name} pending`, value: b.pending, unit: "INR", source: party.kind === "CUSTOMER" ? "creditTransaction" : "debitTransaction" }];
    text = say(lang, { ta: "Records-ல மறுபடி பார்த்தேன்: ", tl: "Records-la marupadi paathen: ", en: "I checked your records again: " }) + replies.balanceReply(lang, b);
    if (u.claimedAmount !== undefined) {
      text += " " + replies.claimReply(lang, u.claimedAmount, b.pending);
      status = Math.abs(u.claimedAmount - b.pending) < 0.005 ? "MATCHES_RECORDS" : "CONFLICTS_WITH_RECORDS";
    }
  } else {
    text = say(lang, {
      ta: "எது தப்பு-னு சொல்லுங்க (பேர் / amount) — records-ல check பண்றேன்.",
      tl: "Edhu thappu-nu sollunga (peru / amount) — records-la check panren.",
      en: "Tell me what's wrong (the name or the amount) and I'll check it against your records.",
    });
  }
  await prisma.kaiCorrection.create({
    data: {
      businessId: ctx.businessId,
      userId: ctx.userId,
      messageId: turn.lastAnswer?.messageId,
      said: u.normalized.slice(0, 1000),
      previous: turn.lastAnswer?.text.slice(0, 2000),
      source: `chat:${ctx.userMessageId}`,
      status,
      verifiedAt: status === "UNVERIFIED" ? null : ctx.now,
    },
  });
  text += "\n" + say(lang, {
    ta: "உங்க திருத்தத்தை note பண்ணிட்டேன். Records-ஐ நான் மாத்தல — மாத்தணும்னா entry add / edit பண்ணுங்க.",
    tl: "Unga correction-a note pannitten. Records-a naan maathala — maathanumna entry add / edit pannunga.",
    en: "I've noted your correction. I haven't changed any record — to change one, add or edit the entry.",
  });
  return { intent: "CORRECTION", text, facts, meta: party ? { lastParty: party } : {}, topic: "correction" };
}

// ---------------------------------------------------------------------------------------------------------------------
// Small talk and the honest fallback

function helpText(lang: KaiLang): string {
  return say(lang, {
    ta: "நான் உங்க கடை records-ல இருந்து சொல்வேன்:\n• \"குமார் எவ்வளவு தரணும்\"\n• \"யாரு கிட்ட வாங்கணும்\" (overdue)\n• \"இன்னைக்கு வசூல் எவ்வளவு\"\n• \"அரிசி ஸ்டாக் எவ்வளவு\", \"low stock\"\n• \"குமாருக்கு 500 கடன்\", \"குமார் 300 குடுத்தான்\" (Confirm பண்ணா தான் save)\n• \"500 + 18%\" கணக்கு",
    tl: "Naan unga kadai records-la irundhu solluven:\n• \"Kumar evlo tharanum\"\n• \"Yaaru kitta vaanganum\" (overdue)\n• \"Inniku vasool evlo\"\n• \"Rice stock evlo\", \"low stock\"\n• \"Kumar-ku 500 credit\", \"Kumar 300 kuduthaan\" (Confirm panna thaan save)\n• \"500 + 18%\" kanakku",
    en: "I answer from your shop's records:\n• \"How much does Kumar owe?\"\n• \"Who should I collect from?\" (overdue)\n• \"Today's collections\"\n• \"Rice stock\", \"low stock\"\n• \"Add 500 credit to Kumar\", \"Kumar paid 300\" (saved only after Confirm)\n• Sums like \"500 + 18%\"",
  });
}

function fallback(lang: KaiLang, general: boolean): string {
  return general
    ? say(lang, {
        ta: "இது உங்க records பத்தின கேள்வி இல்ல. நான் இப்போ rule-based mode-ல இருக்கேன் (AI model இல்ல), அதனால இதுக்கு பதில் சொல்ல முடியாது. உங்க கணக்கு, stock, வசூல் பத்தி கேளுங்க.",
        tl: "Idhu unga records pathina kelvi illa. Naan ippo rule-based mode-la irukken (AI model illa), adhanaala idhukku badhil solla mudiyaadhu. Unga kanakku, stock, vasool pathi kelunga.",
        en: "That isn't about your records. I'm running in rule-based mode (no AI model), so I can't answer it. Ask me about balances, stock or collections.",
      })
    : say(lang, {
        ta: "புரியல — கொஞ்சம் வேற மாதிரி சொல்லுங்க. உதா: \"குமார் எவ்வளவு தரணும்\", \"அரிசி ஸ்டாக்\".",
        tl: "Puriyala — konjam vera maadhiri sollunga. Eg: \"Kumar evlo tharanum\", \"Rice stock evlo\".",
        en: "I didn't get that — could you say it another way? For example: \"How much does Kumar owe?\" or \"Rice stock\".",
      });
}

// ---------------------------------------------------------------------------------------------------------------------
// Routing

async function route(ctx: Ctx): Promise<Outcome> {
  const { u, lang, turn, prev } = ctx;

  // "500" right after "Kumar — evlo amount?"
  if (prev.awaitingAmount && u.amounts.length === 1 && ["UNCLEAR", "GENERAL", "REVISE_DRAFT"].includes(u.intent) && u.normalized.split(" ").length <= 4) {
    const a = prev.awaitingAmount;
    const match: PartyMatch = "id" in a.party ? { status: "FOUND", party: a.party, said: a.party.name } : { status: "UNKNOWN", said: a.party.newName };
    return write(ctx, a.intent, match, u.amounts, undefined);
  }

  switch (u.intent) {
    case "SECURITY_REFUSAL":
      return {
        intent: u.intent,
        text: say(lang, {
          ta: "அதை share பண்ண முடியாது. உங்க கடை கணக்கு பத்தி கேளுங்க.",
          tl: "Adha share panna mudiyaadhu. Unga kadai kanakku pathi kelunga.",
          en: "I can't share that. Ask me anything about your shop's records.",
        }),
      };
    case "CHOICE": {
      const choice = turn.choice!;
      const party = choice.options[(u.choiceIndex ?? 1) - 1];
      const match: PartyMatch = { status: "FOUND", party, said: party.name };
      if (choice.intent === "PARTY_BALANCE") return balance(ctx, match);
      const intent = choice.direction ? actionFor(choice.direction, party.kind) : choice.intent;
      return write(ctx, intent, match, choice.amount !== undefined ? [choice.amount] : [], choice.direction);
    }
    case "CANCEL_DRAFT": {
      await cancelDraft(ctx.businessId, turn.pendingDraft!.id);
      return { intent: u.intent, text: say(lang, { ta: "Cancel பண்ணிட்டேன் — எதுவும் save ஆகல.", tl: "Cancel pannitten — edhuvum save aagala.", en: "Cancelled — nothing was saved." }) };
    }
    case "CONFIRM_DRAFT": {
      const draft = await prisma.kaiActionDraft.findFirst({ where: { id: turn.pendingDraft!.id, businessId: ctx.businessId } });
      return {
        intent: u.intent,
        draft: draft ?? undefined,
        text: (draft ? draft.summary + "\n" : "") + say(lang, {
          ta: "கீழ இருக்கற Confirm button-ஐ அழுத்துங்க — அப்போ தான் save ஆகும்.",
          tl: "Keezha irukkura Confirm button-a press pannunga — appo thaan save aagum.",
          en: "Tap the Confirm button below — that's when it gets saved.",
        }),
      };
    }
    case "REVISE_DRAFT":
      return revise(ctx, u.amount!);
    case "CORRECTION":
      return correction(ctx);
    case "REMEMBER":
      return remember(ctx);
    case "RECALL":
      return recall(ctx);
    case "CALCULATE":
      return calculate(ctx);
    case "ADD_CREDIT":
    case "ADD_DEBIT":
    case "RECORD_PAYMENT":
      return write(ctx, u.intent, u.party, u.amounts, u.direction);
    case "PARTY_BALANCE":
      return balance(ctx, u.party, u.claimedAmount);
    case "TOTAL_RECEIVABLE": {
      const t = await tools.totals(ctx.businessId);
      return { intent: u.intent, text: replies.totalReceivableReply(lang, t), phrase: true, facts: [{ label: "total receivable", value: t.receivable, unit: "INR", source: "creditTransaction" }], topic: "receivable" };
    }
    case "TOTAL_PAYABLE": {
      const t = await tools.totals(ctx.businessId);
      return { intent: u.intent, text: replies.totalPayableReply(lang, t), phrase: true, facts: [{ label: "total payable", value: t.payable, unit: "INR", source: "debitTransaction" }], topic: "payable" };
    }
    case "OVERDUE": {
      const list = await tools.overdueCustomers(ctx.businessId, ctx.now);
      return { intent: u.intent, text: replies.overdueReply(lang, list), facts: list.slice(0, 5).map((e) => ({ label: `${e.name} overdue`, value: e.amount, unit: "INR", source: "creditTransaction" })), topic: "overdue" };
    }
    case "TODAY_SUMMARY": {
      const t = await tools.todaySummary(ctx.businessId, ctx.now);
      return {
        intent: u.intent,
        text: replies.todayReply(lang, t),
        phrase: true,
        facts: [
          { label: "credit given today", value: t.creditGiven, unit: "INR", source: "creditTransaction" },
          { label: "collected today", value: t.collected, unit: "INR", source: "payment" },
        ],
        topic: "today",
      };
    }
    case "STOCK":
      return stock(ctx);
    case "REPORT":
      return report(ctx);
    case "WHICH_SIDE":
      return {
        intent: u.intent,
        meta: { sideAsked: true },
        text: say(lang, {
          ta: "ஓனர், உங்களுக்கு வர வேண்டியதா (கஸ்டமர்கள் தரணும்), இல்ல நீங்க கொடுக்க வேண்டியதா (சப்ளையர்களுக்கு)? \"எனக்கு யாரு தரணும்\" இல்ல \"நான் யாருக்கு தரணும்\"-னு சொல்லுங்க.",
          tl: "Owner, ungalukku vara vendiyadha (customers tharanum), illa neenga kudukka vendiyadha (suppliers-ku)? \"Enakku yaaru tharanum\" illa \"naan yaarukku tharanum\"-nu sollunga.",
          en: "Owner, money to come in (customers owe you), or money you pay (suppliers)? Say \"who owes me\" or \"who do I owe\".",
        }),
      };
    case "HOW_TO":
      return { intent: u.intent, text: replies.howToReply(lang, u.howTo ?? "UNSUPPORTED"), topic: "how to" };
    case "LOW_STOCK": {
      const list = await tools.lowStock(ctx.businessId);
      return { intent: u.intent, text: replies.lowStockReply(lang, list), facts: list.slice(0, 8).map((s) => ({ label: `${s.name} stock`, value: s.currentStock, unit: s.unit, source: "inventoryProduct" })), topic: "low stock" };
    }
    case "CASH_FLOW": {
      const w = await tools.nextWeekCashFlow(ctx.businessId, ctx.now);
      return { intent: u.intent, text: replies.cashFlowReply(lang, w), phrase: true, facts: [{ label: "expected collections 7d", value: w.expectedCollections, unit: "INR", source: "creditTransaction" }], topic: "cash flow" };
    }
    case "GREETING":
      return {
        intent: u.intent,
        text: say(lang, {
          ta: "வணக்கம்! கணக்கு, stock, இன்னைக்கு வசூல் — எது வேணாலும் கேளுங்க.",
          tl: "Vanakkam! Kanakku, stock, inniku vasool — edhu venaalum kelunga.",
          en: "Hello! Ask me about balances, stock or today's collections.",
        }),
      };
    case "THANKS":
      return { intent: u.intent, text: say(lang, { ta: "சரி! வேற ஏதாவது?", tl: "Sari! Vera edhavadhu?", en: "You're welcome! Anything else?" }) };
    case "HELP":
      return { intent: u.intent, text: helpText(lang) };
    case "GENERAL":
      return { intent: u.intent, text: fallback(lang, true), general: true };
    default:
      return { intent: "UNCLEAR", text: fallback(lang, false) };
  }
}

/** A model may only name one of these (no person, no amount, no write). */
const MODEL_ROUTABLE: KaiIntent[] = ["TOTAL_RECEIVABLE", "TOTAL_PAYABLE", "OVERDUE", "TODAY_SUMMARY", "LOW_STOCK", "CASH_FLOW", "HELP", "GENERAL"];

async function withModel(ctx: Ctx, out: Outcome): Promise<{ out: Outcome; engine: KaiEngineInfo }> {
  const model = kaiModel();
  const ruleEngine: KaiEngineInfo = { mode: "rule-based", label: RULE_BASED_LABEL };
  if (!model.enabled) return { out, engine: ruleEngine };
  const owner = JSON.stringify({ OWNER_SAID: ctx.u.normalized.slice(0, 1000) });

  if (out.general) {
    // First: maybe it is a record question the rules missed (only no-entity, read-only ones).
    const label = await model.complete([{ role: "system", content: classifyPrompt(MODEL_ROUTABLE) }, { role: "user", content: owner }], { json: true, maxTokens: 30 });
    try {
      const intent = JSON.parse(label ?? "{}").intent as KaiIntent;
      if (MODEL_ROUTABLE.includes(intent) && intent !== "GENERAL") {
        const routed = await route({ ...ctx, u: { ...ctx.u, intent } });
        return { out: routed, engine: { mode: "local-model", label: modelLabel(model.name), model: model.name } };
      }
    } catch {
      // Not JSON: ignore the model's label.
    }
    const answer = await model.complete([{ role: "system", content: generalPrompt(ctx.lang) }, { role: "user", content: owner }], { maxTokens: 400 });
    if (acceptGeneral(answer)) {
      return { out: { ...out, text: answer.trim() }, engine: { mode: "local-model", label: GENERAL_MODEL_LABEL(model.name), model: model.name } };
    }
    return { out, engine: ruleEngine };
  }

  if (out.phrase) {
    const candidate = await model.complete(
      [{ role: "system", content: phrasePrompt(ctx.lang) }, { role: "user", content: JSON.stringify({ DRAFT: out.text, OWNER_SAID: ctx.u.normalized.slice(0, 500) }) }],
      { maxTokens: 300 },
    );
    if (acceptPhrasing(out.text, candidate)) {
      return { out: { ...out, text: candidate.trim() }, engine: { mode: "local-model", label: modelLabel(model.name), model: model.name } };
    }
  }
  return { out, engine: ruleEngine };
}

// ---------------------------------------------------------------------------------------------------------------------

export interface ChatInput {
  businessId: string;
  userId: string;
  message: string;
  conversationId?: string;
  now?: Date;
}

export async function chat(input: ChatInput): Promise<KaiReply> {
  const now = input.now ?? new Date();
  const conversation = input.conversationId
    ? await prisma.kaiConversation.findFirst({ where: { id: input.conversationId, businessId: input.businessId, userId: input.userId } })
    : await prisma.kaiConversation.create({ data: { businessId: input.businessId, userId: input.userId } });
  if (!conversation) throw new NotFoundError("Conversation not found");

  const [{ turn, meta: prev }, directory, memories] = await Promise.all([
    loadTurnContext(conversation.id, input.businessId, now),
    tools.loadDirectory(input.businessId),
    approvedMemories(input.businessId),
  ]);
  const u = understand({ text: input.message, parties: directory.parties, products: directory.products, aliases: aliasesOf(memories), turn });
  const lang = replyLanguageOf(memories) ?? (turn.lastLang && saysNoLanguage(input.message) ? turn.lastLang : u.lang);

  const userMessage = await prisma.kaiMessage.create({
    data: { conversationId: conversation.id, businessId: input.businessId, role: "USER", text: input.message, lang: u.lang, intent: u.intent },
  });

  const ctx: Ctx = {
    businessId: input.businessId,
    userId: input.userId,
    conversationId: conversation.id,
    userMessageId: userMessage.id,
    now,
    lang,
    u,
    turn,
    prev,
    parties: directory.parties,
    products: directory.products,
    memories,
  };
  const { out, engine } = await withModel(ctx, await route(ctx));

  // Keep the person / product in view for the next turn unless this reply moved on to another one.
  const meta: TurnMeta = {
    lastParty: out.meta?.lastParty ?? (out.meta?.choice ? undefined : turn.lastParty),
    lastProduct: out.meta?.lastProduct ?? turn.lastProduct,
    choice: out.meta?.choice,
    awaitingAmount: out.meta?.awaitingAmount,
    sideAsked: out.meta?.sideAsked,
    facts: out.facts ?? [],
    draftId: out.draft?.id,
  };
  const assistant = await prisma.kaiMessage.create({
    data: {
      conversationId: conversation.id,
      businessId: input.businessId,
      role: "ASSISTANT",
      text: out.text,
      lang,
      intent: out.intent,
      engine: engine.mode === "rule-based" ? "rule-based" : `model:${engine.model}`,
      meta: meta as unknown as Prisma.InputJsonValue,
    },
  });
  await prisma.kaiConversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: now,
      summary: nextSummary(conversation.summary, { person: out.meta?.lastParty?.name, product: out.meta?.lastProduct?.name, topic: out.topic }),
    },
  });

  return {
    conversationId: conversation.id,
    messageId: assistant.id,
    reply: out.text,
    lang,
    intent: out.intent,
    engine,
    facts: out.facts ?? [],
    draft: out.draft && out.draft.status === "PENDING" ? draftView(out.draft) : undefined,
    choices: out.choices?.map((p, i) => ({ index: i + 1, name: p.name, kind: p.kind })),
  };
}

/** The reply after a confirmed save — read back from the books after the transaction committed. */
export async function savedReply(businessId: string, draft: KaiActionDraft, result: Record<string, unknown>, lang: KaiLang, now: Date): Promise<string> {
  const payload = draft.payload as Record<string, unknown>;
  const name = String(payload.partyName ?? "");
  const amt = rupees(Number(payload.amount ?? 0));
  if (draft.kind === "SAVE_MEMORY") {
    return say(lang, {
      ta: "ஞாபகம் வச்சுக்கிட்டேன் ✓ (OwnerNote-ல save ஆச்சு; AI model retrain ஆகல.)",
      tl: "Nyabagam vechukitten ✓ (OwnerNote-la save aachu; AI model retrain aagala.)",
      en: "Saved ✓ (kept in OwnerNote; no AI model was retrained.)",
    });
  }
  const party: PartyRef = { id: String(result.partyId), name, kind: result.partyKind === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER" };
  const b = await tools.partyBalance(businessId, party, now);
  const after =
    party.kind === "CUSTOMER"
      ? say(lang, { ta: `இப்போ ${name} மொத்தம் ${rupees(b.pending)} தரணும்.`, tl: `Ippo ${name} motham ${rupees(b.pending)} tharanum.`, en: `${name} now owes ${rupees(b.pending)} in total.` })
      : say(lang, { ta: `இப்போ ${name}-க்கு ${rupees(b.pending)} கொடுக்கணும்.`, tl: `Ippo ${name}-ku ${rupees(b.pending)} kudukanum.`, en: `You now owe ${name} ${rupees(b.pending)}.` });
  const what =
    draft.kind === "ADD_CREDIT"
      ? say(lang, { ta: `${name}-க்கு ${amt} கடன்.`, tl: `${name}-ku ${amt} credit.`, en: `${amt} credit to ${name}.` })
      : draft.kind === "ADD_DEBIT"
        ? say(lang, { ta: `${name} purchase ${amt}.`, tl: `${name} purchase ${amt}.`, en: `${amt} purchase from ${name}.` })
        : party.kind === "CUSTOMER"
          ? say(lang, { ta: `${name} ${amt} கொடுத்தாங்க.`, tl: `${name} ${amt} kuduthaanga.`, en: `${name} paid ${amt}.` })
          : say(lang, { ta: `${name}-க்கு ${amt} கொடுத்தீங்க.`, tl: `${name}-ku ${amt} kudutheenga.`, en: `You paid ${name} ${amt}.` });
  return say(lang, { ta: "Save ஆகிடுச்சு ✓ ", tl: "Save aagiduchu ✓ ", en: "Saved ✓ " }) + what + " " + after;
}

