import { detectLang, normalize } from "./language";
import { matchParty, matchProduct, sameName } from "./names";
import { amountsIn, expressionIn } from "./numbers";
import type { KaiIntent, KaiTurnContext, MoneyDirection, PartyMatch, PartyRef, ProductRef, Understanding } from "./types";

/**
 * Rules first (KAI principle 2): what the owner wants, read from their words and the turn before — typed or as the mic
 * writes it. Pure: the shop's names come in as data, so this is tested without a database (tests/kai.intent.test.ts and
 * the evaluation set in eval/goldenSet.ts).
 */

export interface UnderstandInput {
  text: string;
  parties: PartyRef[];
  products: ProductRef[];
  aliases?: { alias: string; partyName: string }[];
  turn?: KaiTurnContext;
}

function words(list: string): RegExp {
  return new RegExp(`(?<![\\p{L}])(?:${list})(?![\\p{L}])`, "iu");
}

const SECURITY = /(system|hidden|internal|developer)\s*(prompt|message|instruction)|your\s+(instructions|rules|prompt|configuration|config)|ignore\s+(all\s+|the\s+|your\s+)?(previous|above|prior|earlier)|api[\s_-]?key|jwt|secret\s*key|database\s*(password|url)|env(ironment)?\s*variables?|other\s+(shop|business|user|owner)s?'?\s*(data|details|records|accounts?)|jailbreak|developer\s*mode|act\s+as\s+(dan|admin)/i;

const QUESTION = words("evlo|evalo|evvalavu|enna|how much|how many|what|ethana|ethanai|yaaru|yaar|who|which|when|eppo|balance|details|status");
const BALANCE = words(
  "evlo|evalo|evvalavu|balance|baaki|baki|pending|how much|owe|owes|tharanum|tharanam|kudukanum|kudukkanum|vaanganum|varanum|account|kanakku|status|due|dues|details|outstanding",
);
const PRONOUN = words("avan|aval|avaru|avar|avanga|ivan|ivaru|ivanga|he|she|him|her|they|them|his|their|antha aalu|athu");

const THEY_GAVE = words(
  "kuduthaan|kuduthan|kuduthaar|kuduthar|kuduthaanga|kuduthanga|kuduthutaan|kuduthittan|kuduthittaan|kattinaan|kattinan|kattitaan|kattinaar|paid|has paid|returned|thirupi kuduthaan|anupinaan|anuppinaan|anupitaan|pay pannitaan|pay pannitaru|pay pannitanga|pay pannaan|gpay pannaan|gpay pannitaan|vanthuchu|vandhuchu|received|collected|vasool aachu|vasool",
);
const I_GAVE = words(
  "kuduthen|koduthen|kuduthutten|kuduthiruken|kuduthirukken|gave|lent|paid to|pay panniten|settle panniten|anupinen|anuppinen|gpay panniten",
);
const COLLECTED = words("vaanginen|vaangiten|vaanginaen|vaangitten");
const BOUGHT = words("bought|purchased|purchase|goods vanthuchu|saamaan vanthuchu|bill vanthuchu");
const CREDIT_WORD = words("credit|kadan|udhaar|udhar|add|ezhuthu|eluthu|podu|entry|write|note pannu|sale");

const OVERDUE = /overdue|due\s*date\s*(mudinj|thaand|cross|pass|over)|late\s*(payment|aana)|yaar(u)?\s*(yaar(u)?\s*)?kitta\s*(vaanganum|vasool)|who\s+(should\s+i|to|do\s+i)\s+collect|collect\s+from|vasool\s+pann|yaar(u)?\s*(yaar(u)?\s*)?tharanum|yaaru\s+ellam\s+tharanum/i;
const RECEIVABLE = words("tharanum|tharanam|varanum|vaanganum|receivable|receivables|to receive|owed to me|vara vendiyathu|market la|outside|velila");
const PAYABLE = words("kudukanum|kudukkanum|payable|payables|i owe|to pay|kodukka vendiyathu|suppliers ku|supplier ku");
const TOTAL = words("total|motham|ellarum|everyone|all|overall|full");
const LOW_STOCK = /low\s*stock|stock\s*(kammi|kuraivu|illa|theernthu|over)|kammi\s*(aa|ah|aana|ana)?\s*(stock|item|product)|theernthu|out\s*of\s*stock|re-?order|enna\s*(enna\s*)?(kammi|theernthu)|stock\s*la\s*kammi|running\s*low/i;
const STOCK = words("stock|inventory|iruku|irukku|irukka|how many|ethana|ethanai|left|available|kaiyila");
const CASH_FLOW = /next\s*(7\s*days|week)|adutha\s*vaaram|cash\s*flow|cashflow|varum\s*vaaram|coming\s*week|7\s*naal/i;
const TODAY = /(inniku|innikku|today|indru|inru)\b.*(sales|vasool|collection|enna\s*nadanth|summary|report|kanakku|evlo|how much|business|vyabaaram)|(sales|collection|summary|report)\b.*\b(inniku|today)/i;
const GREETING = /^(hi+|hello|hey|hai|vanakkam|good\s*(morning|afternoon|evening)|namaste|namaskaram)\b/i;
const THANKS = /^(thanks|thank\s*you|nandri|tq|thx|super|nice|great|ok\s*thanks|romba\s*nandri)\b/i;
const HELP = /\bhelp\b|what\s+can\s+you\s+do|enna\s+(ellam\s+)?panna\s+mudiyum|enna\s+ellam\s+theriyum|how\s+to\s+use|epdi\s+use/i;

const CANCEL = /^(cancel|venam|vendam|venaam|vendaam|no|nope|stop|delete|vidu|illa\s+venam|cancel\s+pannu|don'?t)\b/i;
const CONFIRM = /^(confirm|ok|okay|sari|seri|yes|yeah|aama|aamaa|podu|save|done|correct|confirm\s+pannu|save\s+pannu)\b[\s\S]{0,20}$/i;
const REVISE = /^(illa|ille|no|change|maathu|mathu|actually|instead|make\s+it)\b/i;
const WRONG = /^(illa|ille|no|nope|thappu|tappu|wrong|that'?s\s+wrong|not\s+correct|incorrect|sariyilla|sari\s+illa|thappa)\b|\b(thappu|wrong|thappa\s+solra|thappa\s+sonna)\b/i;

const ALWAYS = words("always|eppovum|epovum|eppavum|ini|inimel|inimae|from now|ennaikum|default|ellathukum");
const LANG_WORD = /(english|tamil|tanglish)/i;
const REPLY_WORD = words("reply|pesu|pesungal|sollu|badhil|answer|talk|speak|respond|type");
const NOTE = /^(?:please\s+)?(?:remember|nyabagam\s+vechuko|nyabagam\s+vachuko|gyabagam\s+vechuko|note\s+pannu|note\s+this|keep\s+in\s+mind|manasula\s+vechuko)\s*[:,-]?\s*(?:that\s+)?(.+)$|^(.+?)\s*[,-]?\s*(?:nyabagam\s+vechuko|nyabagam\s+vachuko|gyabagam\s+vechuko|remember\s+this|note\s+pannu)\s*\.?$/i;
const ALIAS = /^['"]?([\p{L}\p{M} .]{2,40}?)['"]?\s+(?:na|nna|means|=|endral|enraal)\s+['"]?([\p{L}\p{M} .]{2,60}?)['"]?\s*$/u;
const NICKNAME = /^([\p{L}\p{M} .]{2,60}?)(?:-?a|-?ai|ை)?\s+(?:naan|nan|naa)\s+['"]?([\p{L}\p{M} .]{2,40}?)['"]?\s*(?:nu|ndru|endru)\s+(?:kupduven|kupiduven|kooppiduven|solluven|kooduven)/u;
const RECALL = /what\s+did\s+i\s+(tell|say|ask)|enna\s+sonnen|nyabagam\s+irukka|my\s+preferences|ennoda\s+(rules|preference|notes)|what\s+do\s+you\s+remember|enna\s+nyabagam/i;

function directionOf(n: string): MoneyDirection | undefined {
  if (THEY_GAVE.test(n)) return "THEY_GAVE";
  if (I_GAVE.test(n)) return "I_GAVE";
  if (COLLECTED.test(n)) return /saamaan|saman|goods|stock|items?|bill|sarakku/.test(n) ? "I_BOUGHT" : "I_TOOK";
  if (BOUGHT.test(n)) return "I_BOUGHT";
  if (CREDIT_WORD.test(n)) return "CREDIT_WORD";
  return undefined;
}

/** The write a direction means for this kind of person. */
export function actionFor(direction: MoneyDirection, kind?: PartyRef["kind"]): KaiIntent {
  // A supplier: paying them is a payment; anything they gave or I took from them is a purchase.
  if (kind === "SUPPLIER") return direction === "I_GAVE" ? "RECORD_PAYMENT" : "ADD_DEBIT";
  if (direction === "THEY_GAVE" || direction === "I_TOOK") return "RECORD_PAYMENT";
  if (direction === "I_BOUGHT") return "ADD_DEBIT";
  return "ADD_CREDIT";
}

export function understand(input: UnderstandInput): Understanding {
  const { text, parties, products, aliases = [], turn = {} } = input;
  const lang = detectLang(text);
  const n = normalize(text);
  const cased = normalize(text, true);
  const amounts = amountsIn(n);
  const base: Understanding = { lang, normalized: n, intent: "UNCLEAR", party: { status: "NONE" }, product: { status: "NONE" }, amounts };
  const is = (intent: KaiIntent, extra: Partial<Understanding> = {}): Understanding => ({ ...base, intent, ...extra });

  if (n.length === 0) return base;
  if (SECURITY.test(n)) return is("SECURITY_REFUSAL");

  // A choice Kai asked for: "1", "rendaavathu", or one of the names offered.
  if (turn.choice) {
    const ordinal = /^(?:#|no\.?\s*)?(\d)\s*$|^(first|second|third|onnu|rendu|moonu|mudhal|rendaavathu|moonaavathu)\b/i.exec(n);
    if (ordinal) {
      const map: Record<string, number> = { first: 1, onnu: 1, mudhal: 1, second: 2, rendu: 2, rendaavathu: 2, third: 3, moonu: 3, moonaavathu: 3 };
      const index = ordinal[1] ? Number(ordinal[1]) : map[ordinal[2].toLowerCase()];
      if (index >= 1 && index <= turn.choice.options.length) return is("CHOICE", { choiceIndex: index });
    }
    const picked = matchParty(cased, turn.choice.options);
    if (picked.status === "FOUND" && n.split(" ").length <= 4) {
      return is("CHOICE", { choiceIndex: turn.choice.options.findIndex((o) => o.id === picked.party.id) + 1 });
    }
  }

  // An open draft: cancel it, point to Confirm, or change its amount ("illa 600").
  if (turn.pendingDraft) {
    if (CANCEL.test(n) && amounts.length === 0) return is("CANCEL_DRAFT");
    if (CONFIRM.test(n) && amounts.length === 0) return is("CONFIRM_DRAFT");
    const onlyAmount = /^(?:₹|rs\.?)?\s*\d[\d,]*(?:\.\d+)?\s*(?:k|rupees|ruba|rs)?\s*(?:thaan|than|only|tha)?$/i.test(n);
    if (amounts.length === 1 && (onlyAmount || REVISE.test(n))) return is("REVISE_DRAFT", { amount: amounts[0] });
  }

  const party = matchParty(cased, parties, aliases);
  const product = matchProduct(cased, products);

  // "That's wrong" after an answer built from the records.
  if (turn.lastAnswer && turn.lastAnswer.facts.length > 0 && WRONG.test(n) && !directionOf(n)) {
    return is("CORRECTION", { party, claimedAmount: amounts[0] });
  }

  // Memory the owner asks Kai to keep (saved only after the owner confirms it).
  if (LANG_WORD.test(n) && REPLY_WORD.test(n) && ALWAYS.test(n)) {
    const want = (LANG_WORD.exec(n)![1] || "").toUpperCase();
    return is("REMEMBER", { memory: { kind: "PREFERENCE", key: "reply_language", value: want } });
  }
  const nick = NICKNAME.exec(cased);
  if (nick) {
    const target = matchParty(nick[1], parties);
    if (target.status === "FOUND") return is("REMEMBER", { memory: { kind: "ALIAS", key: nick[2].trim(), value: target.party.name } });
  }
  const alias = ALIAS.exec(cased);
  if (alias && !amounts.length) {
    const target = matchParty(alias[2], parties);
    if (target.status === "FOUND" && sameName(alias[1], target.party.name) === false) {
      return is("REMEMBER", { memory: { kind: "ALIAS", key: alias[1].trim(), value: target.party.name } });
    }
  }
  const note = NOTE.exec(cased);
  if (note) {
    const value = (note[1] ?? note[2] ?? "").trim();
    if (value.length >= 3) return is("REMEMBER", { memory: { kind: "NOTE", key: "note", value: value.slice(0, 300) } });
  }
  if (RECALL.test(n)) return is("RECALL");

  const direction = directionOf(n);
  const asks = QUESTION.test(n) || n.endsWith("?");

  // Arithmetic is done by code. Not when the numbers are a payment ("Kumar 500 + 200 kuduthaan" is asked about below).
  const expression = expressionIn(n);
  if (expression && !(direction && party.status !== "NONE")) return is("CALCULATE", { expression });

  // A write: a person, which way the money went, and how much.
  const pronounParty = PRONOUN.test(n) && turn.lastParty ? turn.lastParty : undefined;
  const writeParty: PartyMatch = party.status === "NONE" && pronounParty ? { status: "FOUND", party: pronounParty, said: "" } : party;
  if (direction && !(asks && amounts.length === 0) && writeParty.status !== "NONE") {
    const kind = writeParty.status === "FOUND" ? writeParty.party.kind : undefined;
    return is(actionFor(direction, kind), { party: writeParty, direction, amount: amounts.length === 1 ? amounts[0] : undefined, product });
  }

  if (OVERDUE.test(n)) return is("OVERDUE");
  if (TODAY.test(n)) return is("TODAY_SUMMARY");
  if (CASH_FLOW.test(n)) return is("CASH_FLOW");
  if (LOW_STOCK.test(n)) return is("LOW_STOCK", { product });

  // A person's balance: by name, by "avan / he" after one was talked about, or "evlo?" on its own right after.
  if (party.status === "FOUND" || party.status === "AMBIGUOUS") {
    if (product.status === "FOUND" && STOCK.test(n) && !BALANCE.test(n)) return is("STOCK", { product });
    return is("PARTY_BALANCE", { party, claimedAmount: amounts[0] });
  }
  if (pronounParty && (BALANCE.test(n) || asks)) {
    return is("PARTY_BALANCE", { party: { status: "FOUND", party: pronounParty, said: "" }, claimedAmount: amounts[0] });
  }

  if (product.status !== "NONE" && (STOCK.test(n) || asks || n.split(" ").length <= 3)) return is("STOCK", { product });
  if (/\bstock\b/.test(n)) return is("STOCK", { product });

  // "Suresh evlo tharanum" with no Suresh in the books: said back plainly, never answered as the shop's total.
  const totalAsk = TOTAL.test(n) || /market|velila|outside|ellaar|suppliers?\b|customers\b/.test(n);
  if (party.status === "UNKNOWN" && !totalAsk && (BALANCE.test(n) || asks)) return is("PARTY_BALANCE", { party });
  if (PAYABLE.test(n)) return is("TOTAL_PAYABLE");
  if (RECEIVABLE.test(n) || (TOTAL.test(n) && BALANCE.test(n))) return is("TOTAL_RECEIVABLE");
  if (turn.lastParty && /^(evlo|evalo|balance|baaki|pending|how much)\s*\??$/.test(n)) {
    return is("PARTY_BALANCE", { party: { status: "FOUND", party: turn.lastParty, said: "" } });
  }

  if (GREETING.test(n) && n.split(" ").length <= 5) return is("GREETING");
  if (THANKS.test(n) && n.split(" ").length <= 5) return is("THANKS");
  if (HELP.test(n)) return is("HELP");
  if (direction && amounts.length > 0) return is(actionFor(direction), { party, direction, amount: amounts.length === 1 ? amounts[0] : undefined });

  return is(n.split(" ").length >= 2 || n.length >= 12 ? "GENERAL" : "UNCLEAR", { party, product });
}
