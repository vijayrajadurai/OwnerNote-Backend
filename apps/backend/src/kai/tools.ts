import { prisma } from "../db/prisma";
import { toNumber } from "../utils/decimal";
import { getCashFlowSummary } from "../ai/cashFlowAnalyzer";
import type { PartyRef, ProductRef } from "./types";

/**
 * Kai's read-only business tools. Every query is scoped by the caller's businessId (tenant isolation) and every
 * number comes from the books — CreditTransaction / DebitTransaction / Payment / InventoryProduct — never from a model.
 */

const DIRECTORY_LIMIT = 5000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of the owner's day (India time) as a UTC instant. */
export function startOfIstDay(now: Date): Date {
  const local = now.getTime() + IST_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - IST_OFFSET_MS);
}

export async function loadDirectory(businessId: string): Promise<{ parties: PartyRef[]; products: ProductRef[] }> {
  const [customers, suppliers, products] = await Promise.all([
    prisma.customer.findMany({ where: { businessId }, select: { id: true, name: true }, take: DIRECTORY_LIMIT }),
    prisma.supplier.findMany({ where: { businessId }, select: { id: true, name: true }, take: DIRECTORY_LIMIT }),
    prisma.inventoryProduct.findMany({ where: { businessId }, select: { id: true, name: true, brand: true }, take: DIRECTORY_LIMIT }),
  ]);
  return {
    parties: [
      ...customers.map((c) => ({ id: c.id, name: c.name, kind: "CUSTOMER" as const })),
      ...suppliers.map((s) => ({ id: s.id, name: s.name, kind: "SUPPLIER" as const })),
    ],
    products,
  };
}

export interface PartyBalance {
  party: PartyRef;
  /** Still to be paid: by the customer to the owner, or by the owner to the supplier. */
  pending: number;
  pendingEntries: number;
  totalEntries: number;
  overdue: number;
  nextDue: Date | null;
  lastPayment: { amount: number; at: Date } | null;
}

export async function partyBalance(businessId: string, party: PartyRef, now: Date): Promise<PartyBalance> {
  const where = { businessId, ...(party.kind === "CUSTOMER" ? { customerId: party.id } : { supplierId: party.id }) };
  const select = {
    amount: true, paidAmount: true, dueDate: true, status: true, transactionDate: true, createdAt: true,
    payments: { select: { amount: true, createdAt: true }, orderBy: { createdAt: "desc" as const }, take: 1 },
  };
  const rows =
    party.kind === "CUSTOMER"
      ? await prisma.creditTransaction.findMany({ where, select })
      : await prisma.debitTransaction.findMany({ where, select });
  const today = startOfIstDay(now);
  let pending = 0;
  let overdue = 0;
  let pendingEntries = 0;
  let nextDue: Date | null = null;
  let lastPayment: PartyBalance["lastPayment"] = null;
  for (const r of rows) {
    const left = toNumber(r.amount) - toNumber(r.paidAmount);
    for (const p of r.payments) {
      if (!lastPayment || p.createdAt > lastPayment.at) lastPayment = { amount: toNumber(p.amount), at: p.createdAt };
    }
    if (left <= 0.004) continue;
    pending += left;
    pendingEntries++;
    if (r.dueDate && r.dueDate < today) overdue += left;
    else if (r.dueDate && (!nextDue || r.dueDate < nextDue)) nextDue = r.dueDate;
  }
  return { party, pending: round2(pending), pendingEntries, totalEntries: rows.length, overdue: round2(overdue), nextDue, lastPayment };
}

export interface Totals {
  receivable: number;
  receivableParties: number;
  payable: number;
  payableParties: number;
  topReceivable: { name: string; amount: number }[];
  topPayable: { name: string; amount: number }[];
}

export async function totals(businessId: string): Promise<Totals> {
  const [credits, debits] = await Promise.all([
    prisma.creditTransaction.findMany({
      where: { businessId, status: { not: "PAID" } },
      select: { amount: true, paidAmount: true, customer: { select: { id: true, name: true } } },
    }),
    prisma.debitTransaction.findMany({
      where: { businessId, status: { not: "PAID" } },
      select: { amount: true, paidAmount: true, supplier: { select: { id: true, name: true } } },
    }),
  ]);
  const group = (rows: { amount: unknown; paidAmount: unknown; who: { id: string; name: string } }[]) => {
    const by = new Map<string, { name: string; amount: number }>();
    for (const r of rows) {
      const left = toNumber(r.amount as never) - toNumber(r.paidAmount as never);
      if (left <= 0.004) continue;
      const e = by.get(r.who.id) ?? { name: r.who.name, amount: 0 };
      e.amount += left;
      by.set(r.who.id, e);
    }
    const list = [...by.values()].map((e) => ({ ...e, amount: round2(e.amount) })).sort((a, b) => b.amount - a.amount);
    return { total: round2(list.reduce((s, e) => s + e.amount, 0)), list };
  };
  const r = group(credits.map((c) => ({ amount: c.amount, paidAmount: c.paidAmount, who: c.customer })));
  const p = group(debits.map((d) => ({ amount: d.amount, paidAmount: d.paidAmount, who: d.supplier })));
  return {
    receivable: r.total,
    receivableParties: r.list.length,
    payable: p.total,
    payableParties: p.list.length,
    topReceivable: r.list.slice(0, 5),
    topPayable: p.list.slice(0, 5),
  };
}

export interface OverdueEntry {
  name: string;
  amount: number;
  daysLate: number;
}

export async function overdueCustomers(businessId: string, now: Date): Promise<OverdueEntry[]> {
  const today = startOfIstDay(now);
  const rows = await prisma.creditTransaction.findMany({
    where: { businessId, status: { not: "PAID" }, dueDate: { lt: today } },
    select: { amount: true, paidAmount: true, dueDate: true, customer: { select: { id: true, name: true } } },
  });
  const by = new Map<string, OverdueEntry>();
  for (const r of rows) {
    const left = toNumber(r.amount) - toNumber(r.paidAmount);
    if (left <= 0.004 || !r.dueDate) continue;
    const days = Math.max(1, Math.floor((today.getTime() - startOfIstDay(r.dueDate).getTime()) / DAY_MS));
    const e = by.get(r.customer.id) ?? { name: r.customer.name, amount: 0, daysLate: 0 };
    e.amount = round2(e.amount + left);
    e.daysLate = Math.max(e.daysLate, days);
    by.set(r.customer.id, e);
  }
  return [...by.values()].sort((a, b) => b.amount - a.amount);
}

export interface TodaySummary {
  creditGiven: number;
  creditEntries: number;
  collected: number;
  collections: number;
  purchases: number;
  purchaseEntries: number;
  paidToSuppliers: number;
}

export async function todaySummary(businessId: string, now: Date): Promise<TodaySummary> {
  const from = startOfIstDay(now);
  const to = new Date(from.getTime() + DAY_MS);
  const inDay = { OR: [{ transactionDate: { gte: from, lt: to } }, { transactionDate: null, createdAt: { gte: from, lt: to } }] };
  const [credits, debits, inPayments, outPayments] = await Promise.all([
    prisma.creditTransaction.findMany({ where: { businessId, ...inDay }, select: { amount: true } }),
    prisma.debitTransaction.findMany({ where: { businessId, ...inDay }, select: { amount: true } }),
    prisma.payment.findMany({ where: { createdAt: { gte: from, lt: to }, creditTransaction: { businessId } }, select: { amount: true } }),
    prisma.payment.findMany({ where: { createdAt: { gte: from, lt: to }, debitTransaction: { businessId } }, select: { amount: true } }),
  ]);
  const sum = (rows: { amount: Parameters<typeof toNumber>[0] }[]) => round2(rows.reduce((s, r) => s + toNumber(r.amount), 0));
  return {
    creditGiven: sum(credits),
    creditEntries: credits.length,
    collected: sum(inPayments),
    collections: inPayments.length,
    purchases: sum(debits),
    purchaseEntries: debits.length,
    paidToSuppliers: sum(outPayments),
  };
}

export interface StockLine {
  id: string;
  name: string;
  unit: string;
  currentStock: number;
  minimumStock: number;
}

export async function productStock(businessId: string, productId: string): Promise<StockLine | null> {
  return prisma.inventoryProduct.findFirst({
    where: { id: productId, businessId },
    select: { id: true, name: true, unit: true, currentStock: true, minimumStock: true },
  });
}

export async function lowStock(businessId: string): Promise<StockLine[]> {
  const rows = await prisma.inventoryProduct.findMany({
    where: { businessId },
    select: { id: true, name: true, unit: true, currentStock: true, minimumStock: true },
    orderBy: { name: "asc" },
  });
  return rows.filter((r) => r.currentStock <= r.minimumStock);
}

export async function nextWeekCashFlow(businessId: string, now: Date) {
  const summary = await getCashFlowSummary(businessId, now);
  return summary.next7Days;
}

/** Recent entries for one person with this amount — a possible double entry. */
export async function recentSameAmount(
  businessId: string,
  party: PartyRef,
  amount: number,
  kind: "ENTRY" | "PAYMENT",
  now: Date,
  withinMinutes = 30,
): Promise<boolean> {
  const since = new Date(now.getTime() - withinMinutes * 60 * 1000);
  if (kind === "ENTRY") {
    const n =
      party.kind === "CUSTOMER"
        ? await prisma.creditTransaction.count({ where: { businessId, customerId: party.id, amount, createdAt: { gte: since } } })
        : await prisma.debitTransaction.count({ where: { businessId, supplierId: party.id, amount, createdAt: { gte: since } } });
    return n > 0;
  }
  const n = await prisma.payment.count({
    where: {
      amount,
      createdAt: { gte: since },
      ...(party.kind === "CUSTOMER"
        ? { creditTransaction: { businessId, customerId: party.id } }
        : { debitTransaction: { businessId, supplierId: party.id } }),
    },
  });
  return n > 0;
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
