import { prisma } from "../../db/prisma";
import { NotFoundError } from "../../utils/errors";
import { toNumber } from "../../utils/decimal";
import type { Supplier } from "@prisma/client";

export async function listSuppliers(businessId: string) {
  const suppliers = await prisma.supplier.findMany({
    where: { businessId },
    orderBy: { name: "asc" },
    include: {
      transactions: {
        where: { status: { not: "PAID" } },
        select: { amount: true, paidAmount: true, dueDate: true },
      },
    },
  });

  return suppliers.map((supplier) => {
    const pendingTotal = supplier.transactions.reduce(
      (sum, t) => sum + (toNumber(t.amount) - toNumber(t.paidAmount)),
      0,
    );
    const nextDueDate = supplier.transactions
      .map((t) => t.dueDate)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    return {
      id: supplier.id,
      name: supplier.name,
      phone: supplier.phone,
      pendingTotal,
      nextDueDate: nextDueDate ?? null,
    };
  });
}

export async function getSupplierDetail(businessId: string, supplierId: string) {
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, businessId },
    include: {
      transactions: {
        orderBy: { createdAt: "desc" },
        include: { payments: { orderBy: { createdAt: "desc" } } },
      },
    },
  });

  if (!supplier) throw new NotFoundError("Supplier not found");
  return supplier;
}

export async function createSupplier(
  businessId: string,
  input: { name: string; phone?: string },
): Promise<Supplier> {
  return prisma.supplier.create({ data: { businessId, name: input.name, phone: input.phone } });
}

/** Finds an existing supplier by case-insensitive name match, or creates one. */
export async function findOrCreateSupplierByName(businessId: string, name: string): Promise<Supplier> {
  const existing = await prisma.supplier.findFirst({
    where: { businessId, name: { equals: name, mode: "insensitive" } },
  });
  if (existing) return existing;
  return prisma.supplier.create({ data: { businessId, name } });
}
