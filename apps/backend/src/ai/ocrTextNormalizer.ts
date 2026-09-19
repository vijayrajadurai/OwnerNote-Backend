/**
 * Cleans noisy OCR output before the transaction parser runs.
 * Keeps Tamil / Latin letters and common punctuation used on bills.
 */
export function normalizeOcrText(raw: string): string {
  let text = raw
    .replace(/\r\n/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[|¦]/g, "I")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");

  // Common OCR digit confusions inside numbers.
  text = text.replace(/(\d)[oO](\d)/g, "$10$2");
  text = text.replace(/(\d)[lI](\d)/g, "$11$2");
  text = text.replace(/₹/g, " Rs ");

  // Collapse whitespace but keep line breaks for multi-line bills.
  text = text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

  return text.trim();
}
