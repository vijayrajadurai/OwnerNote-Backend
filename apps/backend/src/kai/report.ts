import type { HowTo, ReportPeriod, ReportTopic } from "./types";

/**
 * Report questions — "customer pending amount-ai kaattunga", "கடந்த மாத பண வரவு", "show me last week's purchase
 * details" — read from the normalized words: a topic, and the period it is for. Typed, English and the mic's Tamil all
 * reach the same words first (language.ts), so they give the same report.
 */

// Most specific first: "supplier pending amount" is payable before "pending" is anything else.
const TOPICS: [ReportTopic, RegExp][] = [
  ["CASH", /cash\s*balance|cash\s*in\s*hand|kaiyila\s*(?:irukkura\s*|evlo\s*)?(?:cash|kaasu|panam)|closing\s*balance|cash\s*evlo|kallapetti|cash\s+(?:do\s+i\s+have\s+)?(?:on|in)\s+hand/],
  ["PAYABLE", /supplier\S*\s*(?:pending|outstanding|baaki)|amount\s*payable|pay\s*(?:panna\s*)?vendiya|payable|kudukka\s*vendiya|supplier-?wise/],
  ["RECEIVABLE", /customer\S*\s*(?:pending|outstanding|baaki|credit\s*pending)|credit\s*receivable|kadan\s*varavu|receivable|thara\s*vendiya|vara\s*vendiya|customer-?wise|credit\s*pending/],
  ["PENDING", /pending\s*(?:amount|report)|ella\s*pending|all\s*pending|pending\s*amounts?|(?:moththa|motham|mothama|total)\s*(?:evlo\s*)?baaki|ella\s*(?:pending|niluvai\w*)|niluvai|pending\s+in\s+total|total\s+pending|outstanding\s+balances|all\s+(?:the\s+)?outstanding/],
  ["PAYMENTS_MADE", /payments?\s*made|naan\s*pay\s*panna|pay\s*panna\s*moththa|paid\s*to\s*suppliers/],
  ["COLLECTIONS", /money\s+came\s+in|did\s+i\s+collect|cash\s*received|cash\s*varavu|collection|vasool|payments?\s*received|received\s*payments?|collect\s*panna|vandha\s*panam|panam\s*vandh/],
  ["SALES", /\bsales?\b|\bsold\b/],
  ["PURCHASES", /purchase/],
  ["EXPENSES", /expenses?|\bselavu|did\s+i\s+spend|how\s+much\s+.*\bspen[dt]/],
  ["PROFIT", /profit|laabam|labam/],
  ["LOSS", /\bloss\b|nashtam/],
  ["STOCK", /\bstock|inventory/],
  ["HISTORY", /transaction\s*history|account\s*entries|\bledger|\bentries\b|history|statement|varalaar|pazhaya\s*kanakku|munn?aa?di\s*enna\s*(?:record|padhivu)|recorded\s+in\s+this\s+account/],
  ["CUSTOMERS", /customers?\s*list|\bcustomers\b/],
  ["SUPPLIERS", /suppliers?\s*list|\bsuppliers\b/],
  ["SUMMARY", /report|summary|surukka/],
];

// Earlier wins: "last week" before "week", a named day before "total".
const PERIODS: [ReportPeriod, RegExp][] = [
  ["YESTERDAY", /yesterday|nethaiya|\bnethu\b|nethiku|neththu/],
  ["LAST_WEEK", /last\s*week|kadantha\s*vaara|pona\s*vaara/],
  ["LAST_MONTH", /last\s*month|kadantha\s*maasa|previous\s*month|kadantha\s*maathathu/],
  ["THIS_WEEK", /this\s*week|indha\s*(?:vaara|week)/],
  ["THIS_MONTH", /this\s*month|indha\s*maasa|maasathoda|\bmonthly\b|maadhaandhira/],
  ["LAST_7_DAYS", /\bweekly\b|vaarandhira|\brecent\b|sameebathiya|last\s*7\s*days/],
  ["TODAY", /today|innaikki|innaikkiya|inniku|innikku|innaikku|innaiku|\bindru\b|kaalai|maalai|morning|evening/],
  ["ALL", /\btotal\b|moththa|motham|overall/],
];

/** What a flow (money in / out over time) means with no period said: today. A balance: as of now. */
const DEFAULT_PERIOD: Record<ReportTopic, ReportPeriod> = {
  RECEIVABLE: "ALL", PAYABLE: "ALL", PENDING: "ALL", CASH: "ALL", STOCK: "ALL", CUSTOMERS: "ALL", SUPPLIERS: "ALL",
  COLLECTIONS: "TODAY", PAYMENTS_MADE: "TODAY", SALES: "TODAY", PURCHASES: "TODAY", EXPENSES: "TODAY", PROFIT: "TODAY",
  LOSS: "TODAY", SUMMARY: "TODAY", HISTORY: "LAST_7_DAYS",
};

export function reportTopic(n: string): ReportTopic | undefined {
  return TOPICS.find(([, re]) => re.test(n))?.[0];
}

export function reportPeriod(n: string, topic: ReportTopic): ReportPeriod {
  // "today's report" / "monthly report" name the report; a period said besides it ("last week's") wins.
  const named = /(?:innaikki|today'?s?|maadhaandhira|monthly)\s+report/.exec(n);
  const rest = named ? n.replace(named[0], " report ") : n;
  const said = PERIODS.find(([, re]) => re.test(rest))?.[0];
  if (said) return said;
  if (named) return /maadhaandhira|monthly/.test(named[0]) ? "THIS_MONTH" : "TODAY";
  return DEFAULT_PERIOD[topic];
}

/** Words that make it a report ("…details", "full report on…", "what the … is") rather than a write. */
const READ_WORDS = /details|report|\blist\b|history|entries|changes|summary|pathina|sambandhamaana|enna-?nu|\bwhat\b|separate|kaattunga|show|check|calculate|explain|thedunga|search|compare|evlo|how\s*much/;
const WRITE_VERB = /\b(?:record|add|serkkunga|serkkavum|seru|sethuko|create|pudhu|pudhusaa|new|enter|edit|delete|remove|neekku|change|correct|thiruth\w*|maathu|mathu|azhichidu|azhi|eduthudu|set|mark|attach|minus|adjust)\b/;
const UNSUPPORTED = /invoice|receipt|discount|\btax\b|excel|export|\bbatch\b|expiry|credit\s*limit|\blimit\b|\bbank\b|budget|refund|\breturn\b|proof|attach|category|reconcile|audit|opening\s*balance|recurring|phone\s*number|reminder\s*anupp/;

/** A write Kai doesn't do from chat, or a feature Owner Note doesn't have. Only when no person + amount was said. */
export function howTo(n: string): HowTo | undefined {
  if (UNSUPPORTED.test(n)) return "UNSUPPORTED";
  if (!WRITE_VERB.test(n)) return undefined;
  if (/\b(?:delete|remove|neekku|azhichidu|azhi|eduthudu)\b/.test(n)) return "DELETE";
  if (/\b(?:edit|correct|change|thiruth\w*|maathu|mathu)\b/.test(n) && /entry|entries|amount|thogai|date|potta|padhiv|thappu|kanakk/.test(n)) return "EDIT";
  // "Prabhu-ai customer list-la seru", "Pudhu supplier-ai add pannunga".
  const adds = /\b(?:add|seru|sethuko|serkkunga|serkkavum|create|pudhu|pudhusaa|new)\b/.test(n);
  if (adds && /\bcustomer/.test(n) && !/evlo|details|report|history/.test(n)) return "CUSTOMER";
  if (adds && /\bsupplier/.test(n) && !/evlo|details|report|history/.test(n)) return "SUPPLIER";
  if (READ_WORDS.test(n.replace(/kaattunga|show|check/g, ""))) return undefined;
  if (/\bsales?\b/.test(n)) return "SALE";
  if (/expense|selavu|rent/.test(n)) return "EXPENSE";
  if (/purchase/.test(n)) return "PURCHASE";
  if (/stock|items?\b/.test(n) && /\b(?:add|minus|remove|adjust|seru|serkkunga|serkkavum)\b/.test(n)) return "STOCK";
  return undefined;
}
