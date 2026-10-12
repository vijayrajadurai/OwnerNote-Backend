import { detectLang, normalize } from "./language";
import { caseOfName, matchParty, matchProduct, sameName } from "./names";
import { amountInWords, amountsIn, expressionIn } from "./numbers";
import { howTo, reportPeriod, reportTopic } from "./report";
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
const RECEIVABLE = words("tharanum|tharanam|varanum|vaanganum|receivable|receivables|to receive|owed to me|vara vendiyathu|market la|outside|velila|owe me|collect money|need to collect");
const PAYABLE = words("kudukanum|kudukkanum|payable|payables|i owe|to pay|kodukka vendiyathu|suppliers ku|supplier ku");
const TOTAL = words("total|motham|ellarum|everyone|all|overall|full");
const LOW_STOCK = /low\s*stock|stock\s*(kammi|kuraivu|illa|theernthu|over)|kammi\s*(aa|ah|aana|ana)?\s*(stock|item|product)|theernthu|out\s*of\s*stock|re-?order|enna\s*(enna\s*)?(kammi|theernthu)|stock\s*la\s*kammi|running\s*low/i;
const STOCK = words("stock|inventory|iruku|irukku|irukka|how many|ethana|ethanai|left|available|kaiyila");
const CASH_FLOW = /next\s*(7\s*days|week|vaaram)|adutha\s*vaaram|cash\s*flow|cashflow|varum\s*vaaram|coming\s*week|7\s*naal/i;
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

// "Kumar enakku 500 rooba tharanum" / "Kumar thara vendiya amount-la innum 500 serkkunga": a new credit, not a question.
const THEY_OWE = /(?:enakku|ennaku)\b[\s\S]*\d[\s\S]*\b(?:tharanum|tharanam|thara\s*venum)\b|thara\s*vendiya\s*amount\S*\s*innum|\d[\d,.]*\s*(?:k\b|rooba\w*|rupees?|ruba\w*|rs\.?)?\s*(?:tharanum|tharanam)\s*$/;
// "Naan Kumar-ku 500 rooba tharanum" / "Kumar-ku kudukka vendiya amount-la innum 500 serkkunga": what the owner owes.
const I_OWE = /\bnaan\b[\s\S]*\d[\s\S]*\b(?:tharanum|kudukanum|kudukkanum|thara\s*venum|kudukka\s*venum)\b|kudukka\s*vendiya\s*amount\S*\s*innum/;

/**
 * Which way the money goes, from how the person was said and the verb (dataset 2, 12 Oct 2026):
 *   still owed  (kudukanum / tharanum / varanum / vaanganum / vendiya / baaki iruku / tharala / kudukala / settle pannanum,
 *                and adding to it: seru / kootti podu / adhigapaduthu / varavu vai)
 *   already paid (kuduthutaan / kuduthuttaaru / kuduthen / kattittaaru / anuppitten / vandhuchu / settle pannitten / varavula podu)
 * × "Kumar-ku / Kumaruku / குமாருக்கு" (to the person: the owner pays or owes) or not (the person pays or owes the owner).
 */
const STILL_OWED = /\b(?:kudukanum|kudukkanum|tharanum|tharanam|varanum|vaanganum|vendiya|tharala|kudukala|adhigapaduthu|pannanum)\b|baaki\s+iruku|kootti\s+podu|kooda\s+seru|\bseru\b|varavu\s+vai|kanakkula\s+podu|\bi\s+owe\b|\bowes\s+me\b|\bstill\s+owe/;
const ALREADY_PAID = /\b(?:settle\s+pann(?:itaan|ittaan|itaru|ittaaru|inaan|itten|iten|en|inen)|clear\s+pann(?:itaan|ittaan|inaan|itten|iten)|(?:pay|transfer|neft|gpay|upi|imps|rtgs)\s+pann(?:en|inen|iten|itten|itaan|ittaan|an|aan|inaan|aaru|itaru|anga)|kattinen|kattinan|katti\s*tan|kattittaan|thandhutaanga|thandhutaan|thandhaan|thandhaaru|thanthutaan|kudthan|kudthaan|kudhuthan|kudhuthaan|anuppiachu|anuppiyaachu|anupiyaachu|anuppinaaru|anupinaaru|anuppinaar|pottan|pottaan|pottaaru|potten|adachitan|adachittaan|adachitten|kuduthutaan|kuduthuttaan|kuduthuttaaru|kuduthutaaru|kuduthaar|kuduthaaru|kuduthaan|kuduthan|kuduthaanga|kuduthen|kuduthuten|kuduthutten|koduthen|kattittaaru|kattinaan|kattitaan|kattinaar|anuppitten|anupitten|anupinen|anuppinen|anupinaan|anuppinaan|anuppichan|anuppichen|vandhuchu|vanthuchu|pannitten|panniten|paid|sent)\b|varavula\s+podu|selavula\s+(?:record|podu)|vaa?nginadhai|petradhai/;

/** English: "I owe Kumar 500", "Kumar still hasn't paid me 500", "I sent 450 to Meena", "Record the 300 received from Mani". */
function englishDirection(n: string): MoneyDirection | undefined {
  if (/\bi\s+(?:still\s+)?haven'?t\s+paid\b|\bi\s+(?:still\s+)?owe\b|\bneed\s+to\s+(?:settle|pay)\b|\bpayable\s+to\b|\bwhat\s+i\s+owe\b|\bi\s+have\s+to\s+(?:give|pay)\b/.test(n)) return "I_OWE";
  if (/\bstill\s+hasn'?t\s+paid\s+me\b|\bowes?\s+me\b|\bneed\s+to\s+(?:collect|get|receive)\b|\breceivable\b|\bowed\s+to\s+me\b|\bhas\s+to\s+(?:give|pay)\s+me\b/.test(n)) return "THEY_OWE";
  if (/\b(?:paid|gave|sent)\s+me\b|\breceived\s+from\b|\bgot\s+\S+\s+(?:rupees\s+)?from\b/.test(n)) return "THEY_GAVE";
  if (/\bi\s+(?:paid|sent|gave|settled)\b|\bpaid\s+to\b|\bsent\s+\S+\s+(?:rupees\s+)?to\b/.test(n)) return "I_GAVE";
  return undefined;
}

export function directionFromCase(n: string, personCase: "DATIVE" | "FROM" | "PLAIN"): MoneyDirection | undefined {
  if (/\d/.test(n) && !n.endsWith("?")) {
    const en = englishDirection(n);
    if (en) return en;
  }
  const toPerson = personCase === "DATIVE" || /\bi\s+(?:owe|paid|sent|gave)\b/.test(n);
  if (STILL_OWED.test(n) && /\d/.test(n) && !n.endsWith("?")) return toPerson ? "I_OWE" : "THEY_OWE";
  if (ALREADY_PAID.test(n)) {
    if (/\b(?:paid|sent)\s+me\b/.test(n)) return "THEY_GAVE";
    return toPerson ? "I_GAVE" : "THEY_GAVE";
  }
  return undefined;
}

/** A cash sale, an expense or a cash purchase with no person in it: "innaikku arisi 500 rooba selavaachu". */
export function cashEntryOf(n: string): "SALE" | "EXPENSE" | "PURCHASE" | undefined {
  if (/\bvithen\b|vithadhula|vithutten|\bvithom\b|\bsold\b|viyabaaram\s+aachu|\bsale\s+aachu|\bin\s+sales\b|\bfrom\s+selling\b/.test(n)) return "SALE";
  if (/selav|\bspent\b|\bexpenses?\b|kharchu/.test(n)) return "EXPENSE";
  if (/vaanginen|vaangiten|vaanga\b[\s\S]*aachu|\bbought\b|purchased|sarakku|cost\s+\S+\s+(?:rupees\s+)?to\s+buy|\bto\s+buy\b/.test(n)) return "PURCHASE";
  // "irumbu kambiku 5000 rooba kuduthen", "current bill-ku 1250 pay pannadhai record pannunga": money paid for something.
  if (/\b(?:kuduthen|kuduthuten|koduthen|paid)\b|pay\s+pannadhai|bill-?ku/.test(n)) return "EXPENSE";
  return undefined;
}

/**
 * Whose money a list question is about (owner, 12 Oct 2026: "naan yaaruku tharanum" listed who owes the owner):
 * the owner pays ("naan", "yaaruku", "who do I owe") → PAYS; the owner gets ("enakku", "yaaru kudukanum", "owes me") →
 * GETS; the verb alone ("tharanum", "evlo kudukkanum") → ASK.
 */
const OWE_VERB = /\b(?:tharanum|tharanam|kudukanum|kudukkanum|kodukkanum|kodukanum|pay|payment|pannanum|settle|owe)\b/;
const OWNER_GETS = /\b(?:enaku|enakku|ennaku|yenaku)\b|owes?\s+me|pay\s+me|kitta\s+irundhu|\b(?:varanum|vaanganum|vanganum|vasool|collect)\b/;
const OWNER_PAYS = /\b(?:naan|nan|yaaruku|yaarukku|yarukku|yaruku|whom)\b|to\s+whom|\bi\s+owe\b|should\s+i\s+pay|do\s+i\s+(?:pay|owe)|who\s+do\s+i/;
const WHO_GIVES = /\b(?:yaar|yaaru|yar|yaru|who)\b/;
const BARE_WORDS = new Set(["evlo", "evvalavu", "evalo", "baaki", "bakki", "innum", "tharanum", "tharanam", "kudukanum", "kudukkanum", "kodukkanum", "kodukanum", "pay", "pannanum", "payment"]);

export function sideOf(n: string): "PAYS" | "GETS" | "ASK" | undefined {
  if (!OWE_VERB.test(n)) return undefined;
  if (OWNER_PAYS.test(n) && !OWNER_GETS.test(n)) return "PAYS";
  if (OWNER_GETS.test(n) || WHO_GIVES.test(n)) return "GETS";
  const words = n.replace(/[?!.,]/g, " ").trim().split(/\s+/);
  return words.length <= 3 && words.every((w) => BARE_WORDS.has(w)) ? "ASK" : undefined;
}

function directionOf(n: string): MoneyDirection | undefined {
  // "Kumar 3000 thaane tharanum?" checks the books; it is not a new entry.
  const statement = /\d/.test(n) && !n.endsWith("?") && !/\b(?:thaane|thane|correct-?a|illaiya|ah|aa)\b/.test(n);
  if (statement && I_OWE.test(n)) return "I_OWE";
  if (statement && THEY_OWE.test(n)) return "THEY_OWE";
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
  if (direction === "I_BOUGHT" || direction === "I_OWE") return "ADD_DEBIT";
  return "ADD_CREDIT";
}

export function understand(input: UnderstandInput): Understanding {
  const { text, parties, products, aliases = [], turn = {} } = input;
  const lang = detectLang(text);
  const n = normalize(text);
  const cased = normalize(text, true);
  const figures = amountsIn(n);
  const spokenAmount = figures.length === 0 ? amountInWords(n) : undefined;
  const amounts = spokenAmount !== undefined ? [spokenAmount] : figures;
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

  // Who the money is about, and how they were said ("Kumaruku" / "Kumar kitta" / "Kumar").
  const saidName = party.status === "FOUND" || party.status === "AMBIGUOUS" || party.status === "UNKNOWN" ? party.said : "";
  const direction = (saidName ? directionFromCase(n, caseOfName(cased.toLowerCase(), saidName.toLowerCase())) : undefined) ?? directionOf(n);
  const asks = QUESTION.test(n) || n.endsWith("?");

  // "Pudhu customer-ai add pannunga", "Kumar kanakkula potta thogaiya maathu", "padhivai azhichidu": no amount, not a draft.
  const early = howTo(n);
  // A feature Owner Note doesn't have ("5 percent discount", "invoice") or a stock change is never a person's entry,
  // amount or not.
  if (early === "UNSUPPORTED" || early === "STOCK") return is("HOW_TO", { howTo: early });
  if (early && early !== "SALE" && early !== "EXPENSE" && early !== "PURCHASE" && amounts.length === 0) return is("HOW_TO", { howTo: early });

  // A cash sale / expense / purchase with nobody in it is not a person's entry.
  const guessedName = party.status === "UNKNOWN" && party.guessed === true;
  if ((party.status === "NONE" || guessedName) && amounts.length > 0 && !(PRONOUN.test(n) && turn.lastParty)) {
    const cash = cashEntryOf(n);
    // A guessed lower-case "name" gives way to a clear sale / expense / purchase verb ("pencil 50 rooba vithen").
    if (cash && (party.status === "NONE" || /vithen|vithadhula|\bsold\b|selav|\bspent\b|vaanginen|\bbought\b|to\s+buy|vaanga\b/.test(n))) {
      return is("HOW_TO", { howTo: cash });
    }
  }

  // Arithmetic is done by code. Not when the numbers are a payment ("Kumar 500 + 200 kuduthaan" is asked about below).
  const expression = expressionIn(n);
  if (expression && !(direction && party.status !== "NONE")) return is("CALCULATE", { expression });

  // A write: a person, which way the money went, and how much.
  const pronounParty = PRONOUN.test(n) && turn.lastParty ? turn.lastParty : undefined;
  const writeParty: PartyMatch = party.status === "NONE" && pronounParty ? { status: "FOUND", party: pronounParty, said: "" } : party;
  // "cash received-ai kaattunga" shows; it doesn't write. A write needs an amount or a write verb.
  const shows = /\b(?:kaattunga|kaattu|kaatu|show|check|calculate|explain|list|thedunga|search|compare|report-aa)\b/.test(n);
  if (direction && !(asks && amounts.length === 0) && !(shows && amounts.length === 0) && writeParty.status !== "NONE") {
    const kind = writeParty.status === "FOUND" ? writeParty.party.kind : undefined;
    return is(actionFor(direction, kind), { party: writeParty, direction, amount: amounts.length === 1 ? amounts[0] : undefined, product });
  }

  // A write Kai doesn't take from chat ("Pudhu customer-ai add pannunga", "entry-ai delete pannunga") or a feature
  // Owner Note doesn't have (invoice, Excel export…): said plainly with where to do it — never a wrong answer.
  const how = howTo(n);
  if (how && !(how !== "UNSUPPORTED" && amounts.length > 0 && party.status !== "NONE")) return is("HOW_TO", { howTo: how });

  // Kai asked "money to come in, or money you pay?": "naan" / "suppliers" / "enakku" / "customers" answers it.
  if (turn.sideAsked && n.split(" ").length <= 4) {
    if (/\b(?:naan|nan|neenga|supplier|suppliers|kudukanum|kudukkanum|payable)\b/.test(n) && !OWNER_GETS.test(n)) return is("TOTAL_PAYABLE");
    if (/\b(?:enakku|enaku|customer|customers|varanum|receivable)\b/.test(n)) return is("TOTAL_RECEIVABLE");
  }
  // Whose money: the owner pays, the owner gets, or the verb alone — asked, never guessed (with someone just talked about: theirs).
  const namedTopic = reportTopic(n);
  if (party.status === "NONE" && amounts.length === 0 && !/kitta\s+vaanganum|collect\s+from|overdue/.test(n) &&
      (!namedTopic || ["SUPPLIERS", "CUSTOMERS", "PENDING"].includes(namedTopic))) {
    const side = sideOf(n);
    if (side === "ASK" && turn.lastParty) return is("PARTY_BALANCE", { party: { status: "FOUND", party: turn.lastParty, said: "" } });
    if (side === "PAYS") return is("TOTAL_PAYABLE");
    if (side === "GETS" && !pronounParty) return is("TOTAL_RECEIVABLE");
    if (side === "ASK") return is("WHICH_SIDE");
  }

  if (OVERDUE.test(n) && party.status === "NONE") return is("OVERDUE");
  if (LOW_STOCK.test(n)) return is("LOW_STOCK", { product });
  if (CASH_FLOW.test(n)) return is("CASH_FLOW");
  if (TODAY.test(n) && !reportTopic(n)) return is("TODAY_SUMMARY");

  // A person's balance: by name, by "avan / he" after one was talked about, or "evlo?" on its own right after.
  if (party.status === "FOUND" || party.status === "AMBIGUOUS") {
    if (product.status === "FOUND" && STOCK.test(n) && !BALANCE.test(n)) return is("STOCK", { product });
    return is("PARTY_BALANCE", { party, claimedAmount: amounts[0] });
  }

  // A report: "customer pending amount-ai kaattunga", "கடந்த மாத பண வரவு", "show me last week's purchase details".
  // "How to increase sales in Diwali?" is advice, not a report on the shop's sales.
  const advice = /\bhow\s+(?:to|can|do\s+i|should)\b|eppadi|epdi|\btips?\b|\bideas?\b|improve|increase|boost|adhigap/.test(n) && !/how\s+much|how\s+many|evlo/.test(n);
  if (!advice && (product.status !== "FOUND" || !STOCK.test(n))) {
    const topic = reportTopic(n);
    // "Kumaroda pazhaya kanakku kaatu": one person's history — said back plainly when they aren't in the books.
    // "Kumar enakku thara vendiya amount-ai kaattunga" with no Kumar in the books: about that person, said back plainly.
    if (party.status === "UNKNOWN" && !party.guessed && (topic === "HISTORY" || topic === "RECEIVABLE" || topic === "PAYABLE" || topic === "PENDING")) return is("PARTY_BALANCE", { party });
    // "Naan suppliers-ku evlo kudukanum" / "yaar yaar kitta panam varanum": the totals, by their verbs.
    if ((topic === undefined || topic === "SUPPLIERS" || topic === "CUSTOMERS" || topic === "SUMMARY") && party.status === "NONE" && !pronounParty) {
      if (PAYABLE.test(n) || /\bnaan\b[\s\S]*\b(?:tharanum|kudukanum|kudukkanum)\b/.test(n)) return is("TOTAL_PAYABLE");
      if (RECEIVABLE.test(n) && !OVERDUE.test(n)) return is("TOTAL_RECEIVABLE");
    }
    if (topic === "RECEIVABLE") return is("TOTAL_RECEIVABLE");
    if (topic === "PAYABLE") return is("TOTAL_PAYABLE");
    if (topic) return is("REPORT", { report: { topic, period: reportPeriod(n, topic) } });
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
