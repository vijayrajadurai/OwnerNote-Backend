/**
 * Checks on model output before the owner sees it. A model reply that fails is dropped and the rule-based reply is
 * used instead — the owner always gets the verified answer.
 */

const LEAK_MARKERS = /system\s*prompt|hard\s*rules|OWNER_SAID|DRAFT:|KAI_MODEL|DATABASE_URL|JWT_SECRET|api[\s_-]?key|BEGIN\s+PRIVATE\s+KEY|```|<\/?script/i;
const URL_LIKE = /https?:\/\/|www\./i;

/** Every number in a text, as written without separators ("₹4,000.50" → "4000.5"). */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => String(Number(n.replace(/,/g, ""))));
}

/** A rephrasing of a fact reply: same numbers (all of them, nothing new), no leaks, no links, sane length. */
export function acceptPhrasing(draft: string, candidate: string | null): candidate is string {
  if (!candidate) return false;
  const text = candidate.trim();
  if (text.length === 0 || text.length > Math.max(400, draft.length * 2.5)) return false;
  if (LEAK_MARKERS.test(text) || URL_LIKE.test(text)) return false;
  const allowed = new Set(numbersIn(draft));
  const used = numbersIn(text);
  if (used.some((n) => !allowed.has(n))) return false;
  const usedSet = new Set(used);
  return [...allowed].every((n) => usedSet.has(n));
}

/** A general (non-record) answer: no rupee figures (it cannot know the shop's money), no leaks, no links. */
export function acceptGeneral(candidate: string | null): candidate is string {
  if (!candidate) return false;
  const text = candidate.trim();
  if (text.length === 0 || text.length > 1200) return false;
  if (LEAK_MARKERS.test(text) || URL_LIKE.test(text)) return false;
  return !/(₹|rs\.?|inr)\s*\d/i.test(text);
}
