import type { Request, Response } from "express";
import { z } from "zod";
import * as businessService from "../business/business.service";
import * as dailyCashService from "./daily-cash.service";
import { UnauthorizedError } from "../../utils/errors";

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const entrySchema = z.object({
  type: z.enum(["IN", "OUT"]),
  amount: z.number().positive(),
  paymentMode: z.enum(["CASH", "UPI"]),
  note: z.string().max(500).nullable().optional(),
  createdAt: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid ISO datetime"),
});

const submitReportSchema = z.object({
  date: dateKeySchema,
  totalIn: z.number().min(0),
  totalOut: z.number().min(0),
  net: z.number(),
  cashIn: z.number().min(0),
  cashOut: z.number().min(0),
  upiIn: z.number().min(0),
  upiOut: z.number().min(0),
  openingBalance: z.number().min(0).optional(),
  entries: z.array(entrySchema).min(1),
});

const upsertOpeningSchema = z.object({
  date: dateKeySchema,
  openingBalance: z.number().min(0),
});

async function requireBusinessId(req: Request): Promise<string> {
  if (!req.auth) throw new UnauthorizedError();
  const business = await businessService.getBusinessForUser(req.auth.userId);
  return business.id;
}

export async function submitDailyCashReport(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const body = submitReportSchema.parse(req.body);
  const report = await dailyCashService.submitDailyCashReport(businessId, body);
  res.status(201).json({ data: report });
}

export async function listDailyCashReports(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const reports = await dailyCashService.listDailyCashReports(businessId);
  res.status(200).json({ data: reports });
}

export async function getDailyCashReport(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const date = dateKeySchema.parse(req.params.date);
  const report = await dailyCashService.getDailyCashReport(businessId, date);
  res.status(200).json({ data: report });
}

export async function upsertDailyCashOpening(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const body = upsertOpeningSchema.parse(req.body);
  const opening = await dailyCashService.upsertDailyCashOpening(businessId, body);
  res.status(200).json({ data: opening });
}

export async function getDailyCashOpening(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const date = dateKeySchema.parse(req.params.date);
  const opening = await dailyCashService.getDailyCashOpening(businessId, date);
  res.status(200).json({ data: opening });
}
