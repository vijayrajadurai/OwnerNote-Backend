import type { KaiLang } from "./types";

/**
 * Language of the owner's message and the mic's Tamil script read as the Tanglish keywords the rules use.
 * Names are never rewritten here — the name matcher (names.ts) compares them by sound.
 */

const TAMIL_SCRIPT = /[஀-௿]/;

const TANGLISH_MARKERS = new Set([
  "evlo", "evvalavu", "evalo", "iruku", "irukku", "irukka", "irukkaa", "enna", "ennaku", "enakku", "sollu", "solren",
  "venum", "venam", "vendam", "tharanum", "tharanam", "kudukanum", "kudukkanum", "vaanganum", "varanum", "kuduthaan",
  "kuduthan", "kuduthaar", "kuduthaanga", "kuduthen", "koduthen", "kattinaan", "pannu", "pannunga", "panniten",
  "pannitaan", "pannitaru", "kitta", "ku", "oda", "baaki", "baki", "kadan", "inniku", "innikku", "nethu", "naalaiku",
  "yaaru", "yaar", "theriyuma", "sari", "illa", "ille", "aama", "vanakkam", "nandri", "kammi", "theernthu", "podu",
  "ezhuthu", "eluthu", "maasam", "vaaram", "anna", "akka", "thambi", "vaanginen", "vaangiten", "motham", "ethana",
  "ethanai", "nyabagam", "gyabagam", "vechuko", "vachuko", "thappu", "ungaluku", "unaku", "pesu", "la", "le",
]);

/** Tamil words the mic writes → the Tanglish the rules read (owner, 10 Oct 2026: typed and spoken are one Kai). */
const SPOKEN: [string, string][] = [
  ["எவ்வளவு", "evlo"], ["எவ்ளோ", "evlo"], ["எவ்வளோ", "evlo"], ["எவ்ளவு", "evlo"], ["எவளோ", "evlo"],
  ["தரணும்", "tharanum"], ["தரனும்", "tharanum"], ["தரணும", "tharanum"],
  ["கொடுக்கணும்", "kudukanum"], ["குடுக்கணும்", "kudukanum"], ["கொடுக்கனும்", "kudukanum"], ["குடுக்கனும்", "kudukanum"],
  ["வாங்கணும்", "vaanganum"], ["வாங்கனும்", "vaanganum"], ["வரணும்", "varanum"], ["வரனும்", "varanum"],
  ["பாக்கி", "baaki"], ["பேலன்ஸ்", "balance"], ["கடன்", "kadan"], ["கிரெடிட்", "credit"], ["பெண்டிங்", "pending"],
  ["ஸ்டாக்", "stock"], ["இருக்கா", "irukka"], ["இருக்கு", "iruku"], ["எத்தனை", "ethana"],
  ["குடுத்துட்டான்", "kuduthaan"], ["கொடுத்துட்டான்", "kuduthaan"], ["குடுத்தான்", "kuduthaan"], ["கொடுத்தான்", "kuduthaan"],
  ["குடுத்தாரு", "kuduthaar"], ["கொடுத்தார்", "kuduthaar"], ["குடுத்தார்", "kuduthaar"], ["குடுத்தாங்க", "kuduthaanga"],
  ["கொடுத்தாங்க", "kuduthaanga"], ["கட்டினான்", "kattinaan"], ["கட்டிட்டான்", "kattinaan"], ["கட்டினார்", "kattinaan"],
  ["குடுத்தேன்", "kuduthen"], ["கொடுத்தேன்", "kuduthen"], ["குடுத்துட்டேன்", "kuduthen"],
  ["வாங்கினேன்", "vaanginen"], ["வாங்கிட்டேன்", "vaanginen"], ["வாங்குனேன்", "vaanginen"],
  ["இன்னைக்கு", "inniku"], ["இன்னிக்கு", "inniku"], ["இன்று", "inniku"],
  ["கம்மி", "kammi"], ["குறைவு", "kammi"], ["தீர்ந்து", "theernthu"], ["தீர்ந்துபோச்சு", "theernthu"],
  ["வணக்கம்", "vanakkam"], ["நன்றி", "nandri"], ["ஹாய்", "hi"], ["ஹலோ", "hello"],
  ["சரி", "sari"], ["வேண்டாம்", "venam"], ["வேணாம்", "venam"], ["கேன்சல்", "cancel"], ["கன்ஃபர்ம்", "confirm"],
  ["தப்பு", "thappu"], ["தவறு", "thappu"], ["இல்லை", "illa"], ["இல்ல", "illa"],
  ["ஞாபகம்", "nyabagam"], ["வச்சுக்கோ", "vechuko"], ["வெச்சுக்கோ", "vechuko"], ["வைச்சுக்கோ", "vechuko"],
  ["அவங்க", "avanga"], ["அவரு", "avaru"], ["அவர்", "avaru"], ["அவன்", "avan"], ["அவள்", "aval"],
  ["மொத்தம்", "motham"], ["டோட்டல்", "total"], ["யாரு", "yaaru"], ["யார்", "yaaru"], ["கிட்ட", "kitta"],
  ["ரூபாய்", "rupees"], ["ரூபா", "rupees"], ["ஆயிரம்", "aayiram"], ["லட்சம்", "lakh"],
  ["ஓவர்டியூ", "overdue"], ["டியூ", "due"], ["சப்ளையர்", "supplier"], ["கஸ்டமர்", "customer"],
  ["அடுத்த", "next"], ["வாரம்", "week"], ["இங்கிலீஷ்ல", "english-la"], ["இங்கிலீஷ்", "english"],
  ["தமிழ்ல", "tamil-la"], ["தமிழ்", "tamil"], ["பேசு", "pesu"], ["பதில்", "badhil"], ["சொல்லு", "sollu"],
  ["எழுது", "ezhuthu"], ["போடு", "podu"], ["சேர்", "add"], ["ஆட்", "add"], ["பண்ணு", "pannu"], ["பண்ணுங்க", "pannunga"],
  ["ஜிபே", "gpay"], ["கேஷ்", "cash"], ["பணம்", "panam"], ["காசு", "kaasu"], ["கணக்கு", "kanakku"],
];

const ENGLISH_MARKERS = new Set([
  "how", "what", "who", "which", "when", "much", "many", "owe", "owes", "paid", "add", "the", "is", "are", "my", "show",
  "tell", "please", "give", "gave", "pay", "yes", "no", "cancel", "thanks", "thank", "hello", "today", "total", "remember",
]);

/**
 * "2", "ok", "Kumar": too short to tell a language. Kai keeps answering in the conversation's language instead of
 * switching to English on a bare number or a name.
 */
export function saysNoLanguage(text: string): boolean {
  if (hasTamilScript(text)) return false;
  const words = text.toLowerCase().split(/[^a-z0-9₹.,]+/).filter(Boolean);
  if (!/[a-z]/i.test(text)) return true;
  return words.length <= 2 && !words.some((w) => ENGLISH_MARKERS.has(w) || TANGLISH_MARKERS.has(w));
}

export function hasTamilScript(text: string): boolean {
  return TAMIL_SCRIPT.test(text);
}

export function detectLang(text: string): KaiLang {
  if (hasTamilScript(text)) return "TAMIL";
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.some((w) => TANGLISH_MARKERS.has(w)) ? "TANGLISH" : "ENGLISH";
}

const SPOKEN_MAP = new Map(SPOKEN);
/** What the mic may glue onto a keyword: "-ல", "-க்கு", "-ஆ", "-உம்" ("ஸ்டாக்ல", "இருக்கா"). */
const TAMIL_TAILS = ["க்கு", "ுக்கு", "கு", "ல", "ில", "ா", "ும்", "ுமா", "ே"];

function spokenWord(token: string): string | undefined {
  const exact = SPOKEN_MAP.get(token);
  if (exact) return exact;
  for (const tail of TAMIL_TAILS) {
    if (token.length > tail.length + 1 && token.endsWith(tail)) {
      const base = SPOKEN_MAP.get(token.slice(0, -tail.length));
      if (base) return base;
    }
  }
  return undefined;
}

/**
 * Lower-case Latin text with the mic's Tamil keywords read as Tanglish, word by word (a name that only contains a
 * keyword — "சரிதா" — is left alone). Unknown Tamil words (names, products) stay as they are.
 */
export function normalize(text: string, keepCase = false): string {
  const spoken = text
    .normalize("NFC")
    .replace(/[\u2018\u2019]/g, "'")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const bare = token.replace(/[?!.,]+$/, "");
      const word = hasTamilScript(bare) ? spokenWord(bare) : undefined;
      return word ? word + token.slice(bare.length) : token;
    })
    .join(" ")
    .trim();
  return keepCase ? spoken : spoken.toLowerCase();
}

/** Pick one of three phrasings by the owner's language. */
export function say(lang: KaiLang, words: { ta: string; tl: string; en: string }): string {
  return lang === "TAMIL" ? words.ta : lang === "TANGLISH" ? words.tl : words.en;
}

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

export function rupees(amount: number): string {
  return `₹${inr.format(Math.round(amount * 100) / 100)}`;
}

export function quantity(value: number): string {
  return inr.format(Math.round(value * 1000) / 1000);
}
