import { prisma } from "../../db/prisma";
import { NotFoundError, ValidationError } from "../../utils/errors";
import { toNumber } from "../../utils/decimal";
import { computeStatus } from "../../utils/transactionStatus";
import { findOrCreateCustomerByName } from "../customers/customers.service";
import type { TransactionStatus } from "@prisma/client";

export interface CreateCreditInput {
  customerId?: string;
  customerName?: string;
  amount: number;
  description?: string;
  dueDate?: string;
  transactionDate?: string;
}

export interface UpdateCreditInput {
  description?: string;
  dueDate?: string | null;
  amount?: number;
}

async function resolveCustomerId(businessId: string, input: CreateCreditInput): Promise<string> {
  if (input.customerId) {
    const customer = await prisma.customer.findFirst({ where: { id: input.customerId, businessId } });
    if (!customer) throw new NotFoundError("Customer not found");
    return customer.id;
  }
  if (input.customerName) {
    const customer = await findOrCreateCustomerByName(businessId, input.customerName.trim());
    return customer.id;
  }
  throw new ValidationError("Provide either customerId or customerName");
}

export async function createCredit(businessId: string, input: CreateCreditInput) {
  if (input.amount <= 0) throw new ValidationError("Amount must be greater than 0");
  const customerId = await resolveCustomerId(businessId, input);

  return prisma.creditTransaction.create({
    data: {
      businessId,
      customerId,
      amount: input.amount,
      description: input.description,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      transactionDate: input.transactionDate ? new Date(input.transactionDate) : null,
    },
    include: { customer: true },
  });
}

export async function listCredit(
  businessId: string,
  filters: { status?: TransactionStatus; customerId?: string },
) {
  return prisma.creditTransaction.findMany({
    where: { businessId, status: filters.status, customerId: filters.customerId },
    include: { customer: true },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
  });
}

export async function getCredit(businessId: string, id: string) {
  const transaction = await prisma.creditTransaction.findFirst({
    where: { id, businessId },
    include: { customer: true, payments: { orderBy: { createdAt: "desc" } } },
  });
  if (!transaction) throw new NotFoundError("Credit transaction not found");
  return transaction;
}

export async function updateCredit(businessId: string, id: string, input: UpdateCreditInput) {
  const existing = await getCredit(businessId, id);

  if (input.amount !== undefined && toNumber(existing.paidAmount) > 0) {
    throw new ValidationError("Cannot change amount after payments have been recorded");
  }
  if (input.amount !== undefined && input.amount <= 0) {
    throw new ValidationError("Amount must be greater than 0");
  }

  return prisma.creditTransaction.update({
    where: { id },
    data: {
      description: input.description,
      dueDate: input.dueDate === undefined ? undefined : input.dueDate ? new Date(input.dueDate) : null,
      amount: input.amount,
    },
    include: { customer: true },
  });
}

export async function deleteCredit(businessId: string, id: string): Promise<void> {
  await getCredit(businessId, id);
  await prisma.creditTransaction.delete({ where: { id } });
}

async function applyPayment(businessId: string, id: string, amount: number, note?: string) {
  if (amount <= 0) throw new ValidationError("Payment amount must be greater than 0");

  const transaction = await getCredit(businessId, id);
  const remaining = toNumber(transaction.amount) - toNumber(transaction.paidAmount);
  if (amount > remaining) {
    throw new ValidationError(`Payment exceeds pending balance of ${remaining}`);
  }

  const newPaidAmount = toNumber(transaction.paidAmount) + amount;

  return prisma.$transaction(async (tx) => {
    await tx.payment.create({ data: { creditTransactionId: id, amount, note } });
    return tx.creditTransaction.update({
      where: { id },
      data: { paidAmount: newPaidAmount, status: computeStatus(toNumber(transaction.amount), newPaidAmount) },
      include: { customer: true, payments: { orderBy: { createdAt: "desc" } } },
    });
  });
}

export async function addPayment(businessId: string, id: string, amount: number, note?: string) {
  return applyPayment(businessId, id, amount, note);
}

export async function markPaid(businessId: string, id: string) {
  const transaction = await getCredit(businessId, id);
  const remaining = toNumber(transaction.amount) - toNumber(transaction.paidAmount);
  if (remaining <= 0) throw new ValidationError("Already fully paid");
  return applyPayment(businessId, id, remaining, "Marked as paid");
}
