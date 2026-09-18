import { prisma } from "../../db/prisma";
import { NotFoundError, ValidationError } from "../../utils/errors";
import { toNumber } from "../../utils/decimal";
import { computeStatus } from "../../utils/transactionStatus";
import { findOrCreateSupplierByName } from "../suppliers/suppliers.service";
import type { TransactionStatus } from "@prisma/client";

export interface CreateDebitInput {
  supplierId?: string;
  supplierName?: string;
  amount: number;
  description?: string;
  dueDate?: string;
}

export interface UpdateDebitInput {
  description?: string;
  dueDate?: string | null;
  amount?: number;
}

async function resolveSupplierId(businessId: string, input: CreateDebitInput): Promise<string> {
  if (input.supplierId) {
    const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, businessId } });
    if (!supplier) throw new NotFoundError("Supplier not found");
    return supplier.id;
  }
  if (input.supplierName) {
    const supplier = await findOrCreateSupplierByName(businessId, input.supplierName.trim());
    return supplier.id;
  }
  throw new ValidationError("Provide either supplierId or supplierName");
}

export async function createDebit(businessId: string, input: CreateDebitInput) {
  if (input.amount <= 0) throw new ValidationError("Amount must be greater than 0");
  const supplierId = await resolveSupplierId(businessId, input);

  return prisma.debitTransaction.create({
    data: {
      businessId,
      supplierId,
      amount: input.amount,
      description: input.description,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
    },
    include: { supplier: true },
  });
}

export async function listDebit(
  businessId: string,
  filters: { status?: TransactionStatus; supplierId?: string },
) {
  return prisma.debitTransaction.findMany({
    where: { businessId, status: filters.status, supplierId: filters.supplierId },
    include: { supplier: true },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
  });
}

export async function getDebit(businessId: string, id: string) {
  const transaction = await prisma.debitTransaction.findFirst({
    where: { id, businessId },
    include: { supplier: true, payments: { orderBy: { createdAt: "desc" } } },
  });
  if (!transaction) throw new NotFoundError("Debit transaction not found");
  return transaction;
}

export async function updateDebit(businessId: string, id: string, input: UpdateDebitInput) {
  const existing = await getDebit(businessId, id);

  if (input.amount !== undefined && toNumber(existing.paidAmount) > 0) {
    throw new ValidationError("Cannot change amount after payments have been recorded");
  }
  if (input.amount !== undefined && input.amount <= 0) {
    throw new ValidationError("Amount must be greater than 0");
  }

  return prisma.debitTransaction.update({
    where: { id },
    data: {
      description: input.description,
      dueDate: input.dueDate === undefined ? undefined : input.dueDate ? new Date(input.dueDate) : null,
      amount: input.amount,
    },
    include: { supplier: true },
  });
}

export async function deleteDebit(businessId: string, id: string): Promise<void> {
  await getDebit(businessId, id);
  await prisma.debitTransaction.delete({ where: { id } });
}

async function applyPayment(businessId: string, id: string, amount: number, note?: string) {
  if (amount <= 0) throw new ValidationError("Payment amount must be greater than 0");

  const transaction = await getDebit(businessId, id);
  const remaining = toNumber(transaction.amount) - toNumber(transaction.paidAmount);
  if (amount > remaining) {
    throw new ValidationError(`Payment exceeds pending balance of ${remaining}`);
  }

  const newPaidAmount = toNumber(transaction.paidAmount) + amount;

  return prisma.$transaction(async (tx) => {
    await tx.payment.create({ data: { debitTransactionId: id, amount, note } });
    return tx.debitTransaction.update({
      where: { id },
      data: { paidAmount: newPaidAmount, status: computeStatus(toNumber(transaction.amount), newPaidAmount) },
      include: { supplier: true, payments: { orderBy: { createdAt: "desc" } } },
    });
  });
}

export async function addPayment(businessId: string, id: string, amount: number, note?: string) {
  return applyPayment(businessId, id, amount, note);
}

export async function markPaid(businessId: string, id: string) {
  const transaction = await getDebit(businessId, id);
  const remaining = toNumber(transaction.amount) - toNumber(transaction.paidAmount);
  if (remaining <= 0) throw new ValidationError("Already fully paid");
  return applyPayment(businessId, id, remaining, "Marked as paid");
}
