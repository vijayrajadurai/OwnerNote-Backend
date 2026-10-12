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
  return s.replace(/(.)\1+/g, "$1");
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

/** Two names are the same name by sound ("Kumar" / "குமார்"). */
export function sameName(a: string, b: string): boolean {
  return tokens(a).map(soundKey).join(" ") === tokens(b).map(soundKey).join(" ");
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
  return [...forms].flatMap(keyForms);
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
]);

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

  const candidates: Candidate[] = parties.map((p) => ({ ref: p, keys: tokens(p.name).map(soundKey).filter(Boolean) }));
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
  return said ? { status: "UNKNOWN", said } : { status: "NONE" };
}

/** A word that looks like a person's name but is in no record: "Suresh-ku 500 credit" with no Suresh. */
function unknownName(words: string[]): string | undefined {
  const picked: string[] = [];
  for (const w of words) {
    const bare = w.replace(/-.*$/, "");
    const lower = bare.toLowerCase();
    const isName = /^[\p{L}][\p{L}\p{M}.']*$/u.test(bare) && !NOT_NAME.has(lower) && !/^\d/.test(bare) && lower.length >= 3;
    const tail = /-(ku|kitta|oda|kku|ukku)$/i.test(w) || /(க்கு|கிட்ட|ுக்கு)$/.test(w);
    if (isName && (tail || /^[A-Z\u0B80-\u0BFF]/.test(bare))) {
      picked.push(bare.charAt(0).toUpperCase() + bare.slice(1));
      if (tail) break;
    } else if (picked.length > 0) break;
  }
  if (picked.length === 0) return undefined;
  const name = picked.slice(0, 3).join(" ");
  return name.replace(/(க்கு|ுக்கு|கிட்ட)$/, "");
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
