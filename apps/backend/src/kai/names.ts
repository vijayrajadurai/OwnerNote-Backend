import type { PartyMatch, PartyRef, ProductMatch, ProductRef } from "./types";

/**
 * Names the owner says, matched to the shop's own customers / suppliers / products — never a guess. The mic writes
 * English names in Tamil letters ("குமார்"), so both sides are compared by sound; a name that matches two people is
 * asked about, a name that matches nobody is said plainly.
 */

const VOWELS: Record<string, string> = {
  "அ": "a", "ஆ": "aa", "இ": "i", "ஈ": "ee", "உ": "u", "ஊ": "oo", "எ": "e", "ஏ": "ee", "ஐ": "ai", "ஒ": "o", "ஓ": "oo", "ஔ": "au",
};
const CONSONANTS: Record<string, string> = {
  "க": "k", "ங": "ng", "ச": "s", "ஞ": "nj", "ட": "d", "ண": "n", "த": "th", "ந": "n", "ப": "p", "ம": "m", "ய": "y", "ர": "r",
  "ல": "l", "வ": "v", "ழ": "zh", "ள": "l", "ற": "r", "ன": "n", "ஜ": "j", "ஷ": "sh", "ஸ": "s", "ஹ": "h",
};
const SIGNS: Record<string, string> = {
  "ா": "aa", "ி": "i", "ீ": "ee", "ு": "u", "ூ": "oo", "ெ": "e", "ே": "ee", "ை": "ai", "ொ": "o", "ோ": "oo", "ௌ": "au",
};
const VIRAMA = "்";

/** Tamil letters → Latin ("குமார்" → "kumaar"). Latin text passes through. */
export function transliterate(text: string): string {
  const chars = [...text.normalize("NFC")];
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (VOWELS[c]) {
      out += VOWELS[c];
    } else if (CONSONANTS[c]) {
      out += CONSONANTS[c];
      const next = chars[i + 1];
      if (next === VIRAMA) i++;
      else if (next && SIGNS[next]) {
        out += SIGNS[next];
        i++;
      } else out += "a";
    } else if (c === "ஃ") {
      out += "h";
    } else if (!SIGNS[c] && c !== VIRAMA) {
      out += c;
    }
  }
  return out;
}

/** How a name sounds, so "Ramesh", "ரமேஷ்" and "rameesh" are the same name. */
export function soundKey(word: string): string {
  let s = transliterate(word).toLowerCase().replace(/[^a-z]/g, "");
  s = s
    .replace(/zh/g, "l")
    .replace(/(t|d|s|c|p|b|k|g)h/g, "$1")
    .replace(/x/g, "ks")
    .replace(/q/g, "k")
    .replace(/c/g, "k")
    .replace(/w/g, "v")
    .replace(/f/g, "p")
    .replace(/b/g, "p")
    .replace(/g/g, "k")
    .replace(/d/g, "t")
    .replace(/[jz]/g, "s")
    .replace(/[ey]/g, "i")
    .replace(/o/g, "u");
  // Tamil writes "Lakshmi" as லட்சுமி ("latsumi").
  return s.replace(/ts/g, "ks").replace(/(.)\1+/g, "$1");
}

/** How the mic spells an acronym in Tamil letters: "ABC" → ஏபிசி ("eepisi"). */
const LETTER_SOUNDS: Record<string, string> = {
  a: "ee", b: "pi", c: "si", d: "ti", e: "i", f: "ep", g: "ji", h: "ech", i: "ai", j: "je", k: "ke", l: "el", m: "em",
  n: "en", o: "o", p: "pi", q: "kyu", r: "ar", s: "es", t: "ti", u: "yu", v: "vi", w: "tapilyu", x: "eks", y: "vai", z: "set",
};
function acronymKey(word: string): string | undefined {
  if (!/^[A-Z]{2,6}$/.test(word)) return undefined;
  return soundKey([...word.toLowerCase()].map((c) => LETTER_SOUNDS[c] ?? c).join(""));
}

/** The consonants of a sound key: "piritania" (பிரிட்டானியா) and "pritania" (Britannia) are both "prtn". */
export function skeleton(key: string): string {
  return key.charAt(0) + key.slice(1).replace(/[aiu]/g, "");
}

/** Every way one word of a name may be heard: its sound key, and its consonant skeleton when long enough to be safe. */
function keyForms(key: string): string[] {
  const skel = skeleton(key);
  return skel.length >= 3 ? [key, `~${skel}`] : [key];
}

/** Two names are the same name by sound ("Kumar" / "குமார்", "Prabhu" / "பிரபு"). */
export function sameName(a: string, b: string): boolean {
  const ka = tokens(a).map(soundKey);
  const kb = tokens(b).map(soundKey);
  if (ka.join(" ") === kb.join(" ")) return true;
  return ka.length === kb.length && ka.every((k, i) => {
    const sa = skeleton(k);
    return sa.length >= 3 && sa === skeleton(kb[i]);
  });
}

/** What the owner glues onto a name: "Kumar-ku", "Kumarkitta", "குமாருக்கு", "Kumar oda". */
const LATIN_TAILS = ["ukku", "kku", "ku", "ukitta", "kitta", "kite", "kitte", "oda", "odu", "ode", "uku", "ta", "da", "a", "ah", "aa", "um", "ai"];

function nameForms(token: string): string[] {
  const latin = transliterate(token).toLowerCase().replace(/[^a-z-]/g, "");
  const [head] = latin.split("-");
  const forms = new Set([soundKey(latin), soundKey(head)]);
  for (const tail of LATIN_TAILS) {
    if (head.length - tail.length >= 3 && head.endsWith(tail)) forms.add(soundKey(head.slice(0, -tail.length)));
  }
  forms.delete("");
  // The consonant skeleton only for what the mic wrote in Tamil letters ("பிரிட்டானியா" for Britannia): typed English
  // words keep their vowels, so "collect" is never "Colgate".
  return /[\u0B80-\u0BFF]/.test(token) ? [...forms].flatMap(keyForms) : [...forms];
}

/** Words that are never part of a name (the ask itself, money, particles). */
const NOT_NAME = new Set([
  "evlo", "evalo", "evvalavu", "how", "much", "many", "what", "is", "the", "a", "an", "to", "from", "of", "for", "and", "my", "me",
  "tharanum", "kudukanum", "vaanganum", "varanum", "baaki", "baki", "balance", "pending", "due", "kadan", "credit", "debit",
  "kuduthaan", "kuduthan", "kuduthaar", "kuduthaanga", "kuduthen", "koduthen", "kattinaan", "paid", "pay", "payment", "gave",
  "give", "add", "podu", "ezhuthu", "eluthu", "rs", "rupees", "ruba", "rupee", "inr", "ku", "kitta", "oda", "enakku", "ennaku",
  "naan", "nan", "i", "he", "she", "they", "avan", "aval", "avaru", "avanga", "iruku", "irukku", "irukka", "stock", "enna",
  "sollu", "pannu", "pannunga", "panniten", "pannitaan", "pannitaru", "cash", "gpay", "upi", "phonepe", "paytm", "aayiram",
  "thousand", "lakh", "k", "owe", "owes", "account", "kanakku", "vaanginen", "bought", "purchase", "bill", "supplier",
  "customer", "total", "motham", "today", "inniku", "yaaru", "yaar", "who", "please", "konjam", "sir", "anna", "owner",
  "returned", "received", "vanthuchu", "vandhuchu", "venum", "check", "paaru", "tell", "show", "has", "have", "in", "on",
  "at", "with", "udhaar", "advance", "settle", "settled", "full", "half", "now", "ippo", "innum", "still", "left", "remaining",
  // How owners start a line ("konjam…", "kanakkula…", "padhivula…") and the words around a name.
  "enaku", "konjam", "vegamaa", "kanakkula", "padhivula", "oru", "thadava", "seekiram", "sari", "indha", "andha", "endha", "idhu",
  "innaiku", "innaikku", "nethu", "naalaikku", "naalaiku", "rooba", "roobaya", "roobaikku", "roobai", "irundhu", "seru", "podu",
  "vandhuchu", "baaki", "baakiya", "baakila", "baakiyoda", "kooduthalaa", "varavu", "varavula", "selavula", "record", "yaar",
  "yaaru", "kanakku", "kadai", "kadaiku", "kaatu", "kaattu", "kaattunga", "list", "customer-ai", "supplier-ai", "entry", "evlo-nu",
  // Everyday goods and expenses — never a person (a shop's own products are matched separately, by sound).
  "arisi", "ennai", "sarkkarai", "cement", "irumbu", "kambi", "mobile", "paal", "kaaykari", "tea", "thool", "soap", "biscuit",
  "maligai", "saamaan", "spare", "parts", "cool", "drinks", "cool-drinks", "notebook", "book", "sarakku", "porul", "rent", "current",
  "petrol", "diesel", "salary", "sambalam", "kooli", "gas", "thanni", "rice", "oil", "sugar", "milk", "vegetables", "groceries",
  "aayirathuku", "aayiratthukku", "aayirathukku", "ella", "niluvai", "niluvaiyum", "munnadi", "munnaadi", "naan", "sonna", "thappu",
  // English sentence words that start with a capital but are never a name.
  "yesterday", "tomorrow", "today", "this", "that", "week", "month", "which", "whose", "where", "why", "did", "was", "were", "there",
  "you", "your", "it", "its", "increase", "record", "remove", "change", "delete", "once", "quickly", "please", "for", "also",
  "spent", "sold", "bought", "made", "cost", "still", "need", "another", "additional", "amount", "balance", "payable", "receivable",
  "rupees", "money", "cash", "shop", "shops", "all", "everyone", "who", "what", "show", "tell", "list", "outstanding",
  "vithadhula", "vithen", "selavaachu", "selling", "sell", "buy", "buying", "spend", "spending", "sales", "sale", "vaanga",
  "first", "more", "before", "again", "settle", "collect", "get", "receive", "give", "take", "the", "him", "her", "them",
  // Report words ("account entries-ai kaattunga") and polite openers ("Thayavu senju…", "Could you…").
  "entries", "details", "report", "history", "received", "made", "pending", "changes", "summary", "stock", "purchase",
  "expense", "expenses", "profit", "loss", "collection", "transaction", "transactions", "accounts", "statement", "ledger",
  "thayavu", "senju", "muzhusaa", "thelivaaga", "could", "would", "completely", "clearly", "now", "can", "okay", "ok",
  "weekly", "monthly", "total", "recent", "morning", "evening", "full", "separately", "related", "details-ai", "report-ai",
  "pannadhai", "panna", "pannunga", "partial", "konjam", "mattum", "receipt", "invoice", "discount", "tax", "upi", "neft",
  "find", "apply", "mark", "attach", "set", "open", "close", "search", "filter", "select", "generate", "create", "prepare",
  "send", "reconcile", "export", "download", "update", "enter", "edit", "items", "item", "products", "product", "vandha",
  "percent", "sadhaveedham", "this", "sale", "entry-ai", "panam", "mothama", "moththa", "motham", "vendiya", "vendiyavanga",
  "thogai", "thogaiya", "amounts", "ellaaraiyum", "vanginadhai", "vaanginadhai", "petradhai", "kadaiyin", "kadaiyila",
  "surukkathai", "surukkam", "thirakkavum", "customers", "suppliers", "varalaaraiyum", "kanakkin", "kanakkai", "muzhu",
  "tharpothaiya", "iruppai", "reminder", "limit", "overdue", "date", "last", "phone", "number", "name", "ready", "pdf",
]);

/** "Kumaruku" → "Kumar", "Manikitta" → "Mani", "குமாருக்கு" → "குமார்": the name without what is glued onto it. */
export function bareName(token: string): string {
  const t = token.replace(/'s$/i, "").replace(/-(?:ku|kku|ukku|kitta|oda|ai|a|ah|la|ஐ|க்கு|கிட்ட)$/i, "");
  if (/[\u0B80-\u0BFF]/.test(t)) {
    // Formal Tamil adds a consonant after the case ending: "குமாருக்குக்", "குமாருக்குப்".
    const s = t.replace(/(கு|கிட்ட|ட)[கசதப]்$/, "$1");
    if (s !== t) return bareName(s);
    // "சரவணனிடமிருந்து" (from Saravanan).
    if (/ிடமிருந்து$/.test(t)) return t.replace(/ிடமிருந்து$/, "்");
    if (/இடமிருந்து$/.test(t)) return t.replace(/இடமிருந்து$/, "");
    // "குமாருக்கு" is Kumar + ukku, "பிரபுக்கு" is Prabhu + kku: the "u" is the name's own unless it follows ர ன ண ல ள ழ ய ஷ ஸ.
    const u = /^(.*[ரனணலளழயஷஸ])ு(?:க்கு|கிட்ட|க்|ோட)$/.exec(t) ?? /^(.*[ரனணலளழயஷஸ])ோட$/.exec(t);
    if (u) return `${u[1]}்`;
    return t.replace(/(?:க்கு|கிட்ட|கு|ோட)$/, (m) => (m === "ோட" ? "்" : ""));
  }
  const from = /^(.{3,}?)(?:kitta|kitte|oda)$/i.exec(t);
  if (from) return from[1];
  // "Kumaruku" / "Sujithukku" are Kumar / Sujith + u(k)ku; "Prabhuku" is Prabhu + ku; "Karthikku" is Karthik + ku.
  const uku = /^(.{3,}?)u(?:kku|ku)$/i.exec(t);
  if (uku && /[^aeiou]$/i.test(uku[1]) && !/[bdgkp]h$/i.test(uku[1])) return uku[1];
  const ku = /^(.{3,}?)ku$/i.exec(t);
  return ku ? ku[1] : t;
}

/** How the name was said: "Kumar-ku" / "Kumaruku" / "குமாருக்கு" (to him), "Kumar kitta" (from him), or plain. */
export function caseOfName(text: string, said: string): "DATIVE" | "FROM" | "PLAIN" {
  const words = tokens(text);
  const saidWords = tokens(said);
  if (saidWords.length === 0) return "PLAIN";
  const lastSaid = saidWords[saidWords.length - 1];
  const at = words.findIndex((w) => w === lastSaid || bareName(w) === bareName(lastSaid) || bareName(w).toLowerCase() === lastSaid.toLowerCase());
  const last = at >= 0 ? words[at] : lastSaid;
  const next = (at >= 0 ? words[at + 1] ?? "" : "").toLowerCase();
  if (/(?:-?(?:ku|kku|ukku|uku))$/i.test(last) && bareName(last) !== last) return "DATIVE";
  if (/(?:க்கு|கு)(?:[கசதப]்)?$/.test(last)) return "DATIVE";
  if (/^(?:ku|-ku|kku|ukku|க்கு)$/.test(next)) return "DATIVE";
  if (/(?:kitta|kitte|கிட்ட|இடமிருந்து|ிடமிருந்து)$/i.test(last) || /^(?:kitta|kitte|irundhu)$/.test(next)) return "FROM";
  return "PLAIN";
}

function tokens(text: string): string[] {
  return text.split(/[\s,?!.:;]+/).filter(Boolean);
}

/** One word the owner said (all its forms) is this word of a name. */
function heard(forms: string[], key: string): boolean {
  return keyForms(key).some((k) => forms.includes(k));
}

interface Candidate {
  ref: PartyRef;
  keys: string[];
  alias?: string;
}

/**
 * The person the owner named: the longest run of words that sounds like one of the shop's names. A full-name match
 * beats a first-name match; two equally good matches are AMBIGUOUS; a name-like word that matches nobody is UNKNOWN.
 */
export function matchParty(
  text: string,
  parties: PartyRef[],
  aliases: { alias: string; partyName: string }[] = [],
): PartyMatch {
  const words = tokens(text);
  if (words.length === 0) return { status: "NONE" };
  const wordForms = words.map(nameForms);

  const candidates: Candidate[] = parties.flatMap((p) => {
    const words = tokens(p.name);
    const plain = { ref: p, keys: words.map(soundKey).filter(Boolean) };
    // "ABC Traders" also as the mic spells it: ஏபிசி டிரேடர்ஸ்.
    const spelled = words.map((w) => acronymKey(w) ?? soundKey(w));
    return spelled.join(" ") !== plain.keys.join(" ") ? [plain, { ref: p, keys: spelled }] : [plain];
  });
  for (const a of aliases) {
    const targetKeys = tokens(a.partyName).map(soundKey).join(" ");
    for (const p of parties) {
      if (tokens(p.name).map(soundKey).join(" ") === targetKeys) {
        candidates.push({ ref: p, keys: tokens(a.alias).map(soundKey).filter(Boolean), alias: a.alias });
      }
    }
  }

  type Hit = { ref: PartyRef; length: number; full: boolean; start: number };
  const hits: Hit[] = [];
  for (const c of candidates) {
    if (c.keys.length === 0) continue;
    for (let start = 0; start < words.length; start++) {
      let n = 0;
      while (n < c.keys.length && start + n < words.length && heard(wordForms[start + n], c.keys[n])) n++;
      // A first name alone counts ("Kumar" for "Kumar Textiles"); a later word alone ("Textiles") does not.
      if (n > 0) {
        if (NOT_NAME.has(words[start].toLowerCase()) && n === 1) continue;
        hits.push({ ref: c.ref, length: n, full: n === c.keys.length, start });
      }
    }
  }

  if (hits.length > 0) {
    const best = Math.max(...hits.map((h) => h.length * 2 + (h.full ? 1 : 0)));
    const top = hits.filter((h) => h.length * 2 + (h.full ? 1 : 0) === best);
    const unique = [...new Map(top.map((h) => [h.ref.id, h.ref])).values()];
    const said = words.slice(top[0].start, top[0].start + top[0].length).join(" ");
    if (unique.length === 1) return { status: "FOUND", party: unique[0], said };
    return { status: "AMBIGUOUS", options: unique, said };
  }

  const said = unknownName(words);
  if (said) return { status: "UNKNOWN", said };
  const guessed = nameByGrammar(text);
  return guessed ? { status: "UNKNOWN", said: guessed, guessed: true } : { status: "NONE" };
}

/** A word that looks like a person's name but is in no record: "Suresh-ku 500 credit" with no Suresh. */
/** What follows a person's name in a ledger line: "குமார் எனக்கு…", "குமார் கிட்ட…", "குமார் 500…", "குமார் கணக்கு…". */
const PERSON_NEXT = /^(?:\d|₹|enakku|enaku|kitta|innum|thara|kudutha|baakila|baakiyoda|kanakku|kanakkula|evlo|evlo-nu|irundhu|oda|kuduthaan|kuduthaar|kuduthuttaaru|kuduthutaan|kudthan|kattinaan|kattittaaru|pottan|thandhutaan|thandhutaanga|anuppinaaru|ku|kadan|credit|baaki|tharanum|kudukanum|kudukkanum)/;

function unknownName(words: string[]): string | undefined {
  const picked: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const bare = bareName(w);
    const lower = bare.toLowerCase();
    const isName = /^[\p{L}][\p{L}\p{M}.']*$/u.test(bare) && !NOT_NAME.has(lower) && !NOT_NAME.has(w.toLowerCase()) && lower.length >= 3;
    const tail = bare !== w;
    const tamil = /[\u0B80-\u0BFF]/.test(bare);
    // A Tamil-script word the mic wrote is a name only where a name stands — a case ending, or a ledger word after it —
    // so a verb Kai doesn't know ("திறக்கவும்") is never taken for a person.
    const placed = tail || PERSON_NEXT.test((words[i + 1] ?? "").toLowerCase()) || (picked.length > 0 && PERSON_NEXT.test((words[i + 1] ?? "").toLowerCase()));
    if (isName && (tamil ? placed || picked.length > 0 : tail || /^[A-Z]/.test(bare))) {
      picked.push(bare.charAt(0).toUpperCase() + bare.slice(1));
      if (tail) break;
    } else if (picked.length > 0) break;
  }
  if (picked.length === 0) return undefined;
  return picked.slice(0, 3).join(" ");
}

/**
 * A name typed in lower case, read from where it stands: "kumar owes me 500", "i owe kumar 500", "kumar-ku 500",
 * "suresh 500 kuduthaan" (a word right before the amount and a money verb). Only words that are not the ask itself.
 */
function nameByGrammar(text: string): string | undefined {
  const t = text.toLowerCase();
  const pick = (w?: string) => {
    if (!w) return undefined;
    const bare = bareName(w);
    if (bare.length < 3 || NOT_NAME.has(bare) || NOT_NAME.has(w) || !/^[a-z]+$/.test(bare)) return undefined;
    return bare.charAt(0).toUpperCase() + bare.slice(1);
  };
  const before =
    /(?:^|[\s,])([a-z]+(?:'s)?)\s+(?:owes|still\s+hasn'?t|has\s+to|paid\s+me|gave\s+me|sent\s+me)\b/.exec(t) ??
    /\b(?:does|did|will)\s+([a-z]+)\s+(?:owe|have\s+to|pay)\b/.exec(t) ??
    /(?:^|[\s,])([a-z]+)\s+(?:paid|gave|sent|returned)\s+(?:₹|rs\.?\s*)?\d/.exec(t);
  const after = [...t.matchAll(/\b(?:owe|paid|pay|to|from|with)\s+(?=([a-z]+)(?:'s)?\b)/g)].map((m) => pick(m[1])).find(Boolean);
  const glued = /(?:^|\s)([a-z]{3,}(?:ku|kitta))\s+(?:\d|innum|kudukka|thara|naan)/.exec(t);
  const lead = /^(?:\S+\s+){0,2}?([a-z]{3,})\s+(?:enaku|enakku|kitta|innum|thara|kudutha|baakila|baakiyoda|kanakku|kanakkula|evlo|\d)/.exec(t);
  return pick(before?.[1]) ?? after ?? pick(glued?.[1]) ?? pick(lead?.[1]);
}

/** The shop's product the owner named (by sound, whole words), or nothing. */
export function matchProduct(text: string, products: ProductRef[]): ProductMatch {
  const words = tokens(text);
  if (words.length === 0 || products.length === 0) return { status: "NONE" };
  const wordForms = words.map(nameForms);
  type Hit = { ref: ProductRef; score: number };
  const hits: Hit[] = [];
  for (const p of products) {
    const keys = tokens(p.name).map(soundKey).filter((k) => k.length >= 2);
    if (keys.length === 0) continue;
    let matched = 0;
    for (const k of keys) if (wordForms.some((f) => heard(f, k))) matched++;
    if (matched === 0) continue;
    // Every word of the product name, or one distinctive word of it ("atta" for "Aashirvaad Atta") — two products
    // sharing that word are asked about, never picked.
    if (matched === keys.length || keys.some((k) => k.length >= 3 && wordForms.some((f) => heard(f, k)))) {
      hits.push({ ref: p, score: matched * 10 + (matched === keys.length ? 5 : 0) - (keys.length - matched) });
    }
  }
  if (hits.length === 0) return { status: "NONE" };
  const best = Math.max(...hits.map((h) => h.score));
  const top = hits.filter((h) => h.score === best).map((h) => h.ref);
  return top.length === 1 ? { status: "FOUND", product: top[0] } : { status: "AMBIGUOUS", options: top };
}
