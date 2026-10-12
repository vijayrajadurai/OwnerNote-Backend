/** KAI — Owner Note's business assistant. Shared types for the engine (see src/kai/README.md). */

export type KaiLang = "TAMIL" | "TANGLISH" | "ENGLISH";

export type KaiIntent =
  | "GREETING"
  | "THANKS"
  | "HELP"
  | "PARTY_BALANCE"
  | "TOTAL_RECEIVABLE"
  | "TOTAL_PAYABLE"
  | "OVERDUE"
  | "TODAY_SUMMARY"
  | "STOCK"
  | "LOW_STOCK"
  | "CASH_FLOW"
  | "CALCULATE"
  | "ADD_CREDIT"
  | "ADD_DEBIT"
  | "RECORD_PAYMENT"
  | "REMEMBER"
  | "RECALL"
  | "CORRECTION"
  | "CONFIRM_DRAFT"
  | "CANCEL_DRAFT"
  | "REVISE_DRAFT"
  | "CHOICE"
  | "SECURITY_REFUSAL"
  | "GENERAL"
  | "UNCLEAR";

/** Intents that only read. A model may suggest one of these; it may never suggest a write. */
export const READ_ONLY_INTENTS: readonly KaiIntent[] = [
  "PARTY_BALANCE",
  "TOTAL_RECEIVABLE",
  "TOTAL_PAYABLE",
  "OVERDUE",
  "TODAY_SUMMARY",
  "STOCK",
  "LOW_STOCK",
  "CASH_FLOW",
  "HELP",
  "GREETING",
  "THANKS",
  "GENERAL",
];

export type PartyKind = "CUSTOMER" | "SUPPLIER";

/** A customer or supplier of this business, as the matcher sees it (id + name only; never balances). */
export interface PartyRef {
  id: string;
  name: string;
  kind: PartyKind;
}

export interface ProductRef {
  id: string;
  name: string;
  brand?: string | null;
}

/** How a name in the owner's words matched the shop's people. */
export type PartyMatch =
  | { status: "FOUND"; party: PartyRef; said: string }
  | { status: "AMBIGUOUS"; options: PartyRef[]; said: string }
  | { status: "UNKNOWN"; said: string }
  | { status: "NONE" };

export type ProductMatch =
  | { status: "FOUND"; product: ProductRef }
  | { status: "AMBIGUOUS"; options: ProductRef[] }
  | { status: "NONE"; said?: string };

/** Which way money moved, as the owner said it. */
/** "Vaanginen" is "I took": money from a customer, goods from a supplier. */
export type MoneyDirection = "THEY_GAVE" | "I_GAVE" | "I_TOOK" | "I_BOUGHT" | "CREDIT_WORD";

export interface PendingChoice {
  intent: KaiIntent;
  options: PartyRef[];
  amount?: number;
  direction?: MoneyDirection;
}

/** What the engine knows from earlier turns. */
export interface KaiTurnContext {
  lastParty?: PartyRef;
  lastProduct?: ProductRef;
  lastIntent?: KaiIntent;
  /** The language Kai last replied in (kept for "2", "ok", a bare name). */
  lastLang?: KaiLang;
  /** The previous assistant reply and the facts it was built from (for "that's wrong"). */
  lastAnswer?: { messageId: string; text: string; intent: KaiIntent; facts: KaiFact[] };
  pendingDraft?: { id: string; kind: string; amount?: number };
  choice?: PendingChoice;
}

export interface KaiFact {
  label: string;
  /** A number read from the records (money in rupees, or a stock quantity). */
  value: number;
  unit?: string;
  /** Which records it came from, e.g. "creditTransaction". */
  source: string;
}

export interface Understanding {
  lang: KaiLang;
  /** The owner's words with the mic's Tamil script read as Tanglish keywords (names untouched). */
  normalized: string;
  intent: KaiIntent;
  party: PartyMatch;
  product: ProductMatch;
  amount?: number;
  /** More than one amount in a write: asked about, never guessed. */
  amounts: number[];
  direction?: MoneyDirection;
  expression?: string;
  memory?: { kind: "PREFERENCE" | "ALIAS" | "NOTE"; key: string; value: string };
  choiceIndex?: number;
  /** "Illa, 3000 thaan": the number the owner says is right. */
  claimedAmount?: number;
}

export interface KaiEngineInfo {
  mode: "rule-based" | "local-model";
  /** Shown to the owner. The rule-based engine never calls itself AI. */
  label: string;
  model?: string;
}

export interface KaiDraftView {
  id: string;
  kind: string;
  summary: string;
  warnings: string[];
  expiresAt: string;
}

export interface KaiReply {
  conversationId: string;
  messageId: string;
  reply: string;
  lang: KaiLang;
  intent: KaiIntent;
  engine: KaiEngineInfo;
  facts: KaiFact[];
  draft?: KaiDraftView;
  choices?: { index: number; name: string; kind: PartyKind }[];
}
