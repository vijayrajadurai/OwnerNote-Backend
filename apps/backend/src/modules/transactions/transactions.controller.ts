import type { Request, Response } from "express";
import { z } from "zod";
import * as creditService from "./credit.service";
import * as debitService from "./debit.service";
import * as businessService from "../business/business.service";
import { UnauthorizedError } from "../../utils/errors";

const TRANSACTION_STATUSES = ["PENDING", "PARTIALLY_PAID", "PAID"] as const;

const createCreditSchema = z.object({
  customerId: z.string().uuid().optional(),
  customerName: z.string().min(2).max(150).optional(),
  amount: z.number().positive(),
  description: z.string().max(500).optional(),
  dueDate: z.string().datetime().optional(),
});

const createDebitSchema = z.object({
  supplierId: z.string().uuid().optional(),
  supplierName: z.string().min(2).max(150).optional(),
  amount: z.number().positive(),
  description: z.string().max(500).optional(),
  dueDate: z.string().datetime().optional(),
});

const updateSchema = z.object({
  description: z.string().max(500).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  amount: z.number().positive().optional(),
});

const paymentSchema = z.object({
  amount: z.number().positive(),
  note: z.string().max(300).optional(),
});

const listQuerySchema = z.object({
  status: z.enum(TRANSACTION_STATUSES).optional(),
  customerId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
});

async function requireBusinessId(req: Request): Promise<string> {
  if (!req.auth) throw new UnauthorizedError();
  const business = await businessService.getBusinessForUser(req.auth.userId);
  return business.id;
}

// ---- Credit (receivables) ----

export async function createCreditHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const input = createCreditSchema.parse(req.body);
  const transaction = await creditService.createCredit(businessId, input);
  res.status(201).json({ data: transaction });
}

export async function listCreditHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const { status, customerId } = listQuerySchema.parse(req.query);
  const transactions = await creditService.listCredit(businessId, { status, customerId });
  res.status(200).json({ data: transactions });
}

export async function getCreditHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const transaction = await creditService.getCredit(businessId, req.params.id);
  res.status(200).json({ data: transaction });
}

export async function updateCreditHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const input = updateSchema.parse(req.body);
  const transaction = await creditService.updateCredit(businessId, req.params.id, input);
  res.status(200).json({ data: transaction });
}

export async function deleteCreditHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  await creditService.deleteCredit(businessId, req.params.id);
  res.status(204).send();
}

export async function addCreditPaymentHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const { amount, note } = paymentSchema.parse(req.body);
  const transaction = await creditService.addPayment(businessId, req.params.id, amount, note);
  res.status(200).json({ data: transaction });
}

export async function markCreditPaidHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const transaction = await creditService.markPaid(businessId, req.params.id);
  res.status(200).json({ data: transaction });
}

// ---- Debit (payables) ----

export async function createDebitHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const input = createDebitSchema.parse(req.body);
  const transaction = await debitService.createDebit(businessId, input);
  res.status(201).json({ data: transaction });
}

export async function listDebitHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const { status, supplierId } = listQuerySchema.parse(req.query);
  const transactions = await debitService.listDebit(businessId, { status, supplierId });
  res.status(200).json({ data: transactions });
}

export async function getDebitHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const transaction = await debitService.getDebit(businessId, req.params.id);
  res.status(200).json({ data: transaction });
}

export async function updateDebitHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const input = updateSchema.parse(req.body);
  const transaction = await debitService.updateDebit(businessId, req.params.id, input);
  res.status(200).json({ data: transaction });
}

export async function deleteDebitHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  await debitService.deleteDebit(businessId, req.params.id);
  res.status(204).send();
}

export async function addDebitPaymentHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const { amount, note } = paymentSchema.parse(req.body);
  const transaction = await debitService.addPayment(businessId, req.params.id, amount, note);
  res.status(200).json({ data: transaction });
}

export async function markDebitPaidHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const transaction = await debitService.markPaid(businessId, req.params.id);
  res.status(200).json({ data: transaction });
}

// ---- Combined listing ----

export async function listAllHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const { status } = listQuerySchema.parse(req.query);
  const [credit, debit] = await Promise.all([
    creditService.listCredit(businessId, { status }),
    debitService.listDebit(businessId, { status }),
  ]);

  const combined = [
    ...credit.map((t) => ({ ...t, type: "CREDIT" as const, partyName: t.customer.name })),
    ...debit.map((t) => ({ ...t, type: "DEBIT" as const, partyName: t.supplier.name })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  res.status(200).json({ data: combined });
}
