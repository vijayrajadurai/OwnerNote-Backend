import type { TransactionStatus } from "@prisma/client";

export function computeStatus(amount: number, paidAmount: number): TransactionStatus {
  if (paidAmount <= 0) return "PENDING";
  if (paidAmount >= amount) return "PAID";
  return "PARTIALLY_PAID";
}
