import { prisma } from "../../db/prisma";
import { NotFoundError } from "../../utils/errors";
import { toNumber } from "../../utils/decimal";
import type { Customer } from "@prisma/client";

export async function listCustomers(businessId: string) {
  const customers = await prisma.customer.findMany({
    where: { businessId },
    orderBy: { name: "asc" },
    include: {
      transactions: {
        where: { status: { not: "PAID" } },
        select: { amount: true, paidAmount: true, dueDate: true },
      },
    },
  });

  return customers.map((customer) => {
    const pendingTotal = customer.transactions.reduce(
      (sum, t) => sum + (toNumber(t.amount) - toNumber(t.paidAmount)),
      0,
    );
    const nextDueDate = customer.transactions
      .map((t) => t.dueDate)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      pendingTotal,
      nextDueDate: nextDueDate ?? null,
    };
  });
}

export async function getCustomerDetail(businessId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
    include: {
      transactions: {
        orderBy: { createdAt: "desc" },
        include: { payments: { orderBy: { createdAt: "desc" } } },
      },
    },
  });

  if (!customer) throw new NotFoundError("Customer not found");
  return customer;
}

export async function createCustomer(
  businessId: string,
  input: { name: string; phone?: string },
): Promise<Customer> {
  return prisma.customer.create({ data: { businessId, name: input.name, phone: input.phone } });
}

/** Finds an existing customer by case-insensitive name match, or creates one. */
export async function findOrCreateCustomerByName(businessId: string, name: string): Promise<Customer> {
  const existing = await prisma.customer.findFirst({
    where: { businessId, name: { equals: name, mode: "insensitive" } },
  });
  if (existing) return existing;
  return prisma.customer.create({ data: { businessId, name } });
}
