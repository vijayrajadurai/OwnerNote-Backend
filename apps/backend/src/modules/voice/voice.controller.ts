import type { Request, Response } from "express";
import { z } from "zod";
import { parseTransactionText } from "../../ai/transactionParser";

const parseSchema = z.object({
  text: z.string().min(2).max(500),
});

export async function parseVoiceText(req: Request, res: Response): Promise<void> {
  const { text } = parseSchema.parse(req.body);
  const result = parseTransactionText(text);
  res.status(200).json({ data: result });
}
