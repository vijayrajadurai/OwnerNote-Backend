import type { Request, Response } from "express";
import { z } from "zod";
import { parseBillText } from "../../ai/billParser";
import { normalizeOcrText } from "../../ai/ocrTextNormalizer";
import { parseTransactionText } from "../../ai/transactionParser";
import type { ParsedTransaction } from "../../ai/types";

const parseSchema = z.object({
  text: z.string().min(2).max(4000),
});

export function parseOcrToTransaction(text: string): ParsedTransaction & { billDetected: boolean } {
  const normalized = normalizeOcrText(text);
  const bill = parseBillText(normalized);

  if (bill.total !== null) {
    // A shop bill the owner received is a purchase from that shop, so it
    // becomes a supplier (debit) entry: shop name + bill total only.
    let confidence = bill.totalTier === 1 ? 0.75 : 0.6;
    if (bill.shopName) confidence += 0.15;
    return {
      intent: "CREATE_DEBIT",
      partyName: bill.shopName,
      amount: bill.total,
      currency: "INR",
      dueDate: null,
      description: bill.shopName ? `Bill - ${bill.shopName}` : "Shop bill",
      confidence: Math.min(Math.round(confidence * 100) / 100, 0.95),
      rawText: normalized,
      billDetected: true,
    };
  }

  return { ...parseTransactionText(normalized), rawText: normalized, billDetected: false };
}

export async function parseOcrText(req: Request, res: Response): Promise<void> {
  const { text } = parseSchema.parse(req.body);
  res.status(200).json({ data: parseOcrToTransaction(text) });
}
