import { prisma } from "../../db/prisma";
import { NotFoundError } from "../../utils/errors";
import { toNumber } from "../../utils/decimal";

export type ReminderKind = "CUSTOM" | "COLLECTION" | "PAYMENT";

export interface ReminderItem {
  id: string;
  kind: ReminderKind;
  title: string;
  amount?: number;
  dueDate: Date;
  isDone: boolean;
}

export async function listReminders(businessId: string): Promise<ReminderItem[]> {
  const [custom, pendingCredit, pendingDebit] = await Promise.all([
    prisma.reminder.findMany({ where: { businessId, isDone: false }, orderBy: { dueDate: "asc" } }),
    prisma.creditTransaction.findMany({
      where: { businessId, status: { not: "PAID" }, dueDate: { not: null } },
      include: { customer: true },
    }),
    prisma.debitTransaction.findMany({
      where: { businessId, status: { not: "PAID" }, dueDate: { not: null } },
      include: { supplier: true },
    }),
  ]);

  const items: ReminderItem[] = [
    ...custom.map((r) => ({ id: r.id, kind: "CUSTOM" as const, title: r.title, dueDate: r.dueDate, isDone: r.isDone })),
    ...pendingCredit.map((t) => ({
      id: t.id,
      kind: "COLLECTION" as const,
      title: `Collect from ${t.customer.name}`,
      amount: toNumber(t.amount) - toNumber(t.paidAmount),
      dueDate: t.dueDate as Date,
      isDone: false,
    })),
    ...pendingDebit.map((t) => ({
      id: t.id,
      kind: "PAYMENT" as const,
      title: `Pay ${t.supplier.name}`,
      amount: toNumber(t.amount) - toNumber(t.paidAmount),
      dueDate: t.dueDate as Date,
      isDone: false,
    })),
  ];

  return items.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}

export async function createReminder(businessId: string, title: string, dueDate: string) {
  return prisma.reminder.create({ data: { businessId, title, dueDate: new Date(dueDate) } });
}

export async function markReminderDone(businessId: string, id: string) {
  const reminder = await prisma.reminder.findFirst({ where: { id, businessId } });
  if (!reminder) throw new NotFoundError("Reminder not found");
  return prisma.reminder.update({ where: { id }, data: { isDone: true } });
}
