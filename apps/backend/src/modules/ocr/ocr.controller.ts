import type { Request, Response } from "express";
import { z } from "zod";
import { normalizeOcrText } from "../../ai/ocrTextNormalizer";
import { parseTransactionText } from "../../ai/transactionParser";

const parseSchema = z.object({
  text: z.string().min(2).max(4000),
});

export async function parseOcrText(req: Request, res: Response): Promise<void> {
  const { text } = parseSchema.parse(req.body);
  const normalized = normalizeOcrText(text);
  const result = parseTransactionText(normalized);
  res.status(200).json({ data: { ...result, rawText: normalized } });
}
