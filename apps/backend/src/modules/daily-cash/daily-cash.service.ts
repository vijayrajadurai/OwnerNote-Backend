import { prisma } from "../../db/prisma";
import type { DailyCashEntryType, DailyCashPaymentMode, Prisma } from "@prisma/client";
import { NotFoundError } from "../../utils/errors";

export type SubmitDailyCashEntryInput = {
  type: DailyCashEntryType;
  amount: number;
  paymentMode: DailyCashPaymentMode;
  note?: string | null;
  createdAt: string;
};

export type SubmitDailyCashReportInput = {
  date: string;
  totalIn: number;
  totalOut: number;
  net: number;
  cashIn: number;
  cashOut: number;
  upiIn: number;
  upiOut: number;
  entries: SubmitDailyCashEntryInput[];
};

function mapReport(report: {
  id: string;
  businessId: string;
  date: string;
  totalIn: Prisma.Decimal;
  totalOut: Prisma.Decimal;
  net: Prisma.Decimal;
  cashIn: Prisma.Decimal;
  cashOut: Prisma.Decimal;
  upiIn: Prisma.Decimal;
  upiOut: Prisma.Decimal;
  submittedAt: Date;
  entries: Array<{
    id: string;
    type: DailyCashEntryType;
    amount: Prisma.Decimal;
    paymentMode: DailyCashPaymentMode;
    note: string | null;
    entryCreatedAt: Date;
  }>;
}) {
  return {
    id: report.id,
    businessId: report.businessId,
    date: report.date,
    totalIn: Number(report.totalIn),
    totalOut: Number(report.totalOut),
    net: Number(report.net),
    cashIn: Number(report.cashIn),
    cashOut: Number(report.cashOut),
    upiIn: Number(report.upiIn),
    upiOut: Number(report.upiOut),
    submittedAt: report.submittedAt.toISOString(),
    entries: report.entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      amount: Number(entry.amount),
      paymentMode: entry.paymentMode,
      note: entry.note,
      createdAt: entry.entryCreatedAt.toISOString(),
    })),
  };
}

export async function submitDailyCashReport(businessId: string, input: SubmitDailyCashReportInput) {
  const report = await prisma.$transaction(async (tx) => {
    const existing = await tx.dailyCashReport.findUnique({
      where: { businessId_date: { businessId, date: input.date } },
      select: { id: true },
    });

    if (existing) {
      await tx.dailyCashReportEntry.deleteMany({ where: { reportId: existing.id } });
      const updated = await tx.dailyCashReport.update({
        where: { id: existing.id },
        data: {
          totalIn: input.totalIn,
          totalOut: input.totalOut,
          net: input.net,
          cashIn: input.cashIn,
          cashOut: input.cashOut,
          upiIn: input.upiIn,
          upiOut: input.upiOut,
          submittedAt: new Date(),
          entries: {
            create: input.entries.map((entry) => ({
              type: entry.type,
              amount: entry.amount,
              paymentMode: entry.paymentMode,
              note: entry.note?.trim() || null,
              entryCreatedAt: new Date(entry.createdAt),
            })),
          },
        },
        include: { entries: true },
      });
      return updated;
    }

    return tx.dailyCashReport.create({
      data: {
        businessId,
        date: input.date,
        totalIn: input.totalIn,
        totalOut: input.totalOut,
        net: input.net,
        cashIn: input.cashIn,
        cashOut: input.cashOut,
        upiIn: input.upiIn,
        upiOut: input.upiOut,
        entries: {
          create: input.entries.map((entry) => ({
            type: entry.type,
            amount: entry.amount,
            paymentMode: entry.paymentMode,
            note: entry.note?.trim() || null,
            entryCreatedAt: new Date(entry.createdAt),
          })),
        },
      },
      include: { entries: true },
    });
  });

  return mapReport(report);
}

export async function getDailyCashReport(businessId: string, date: string) {
  const report = await prisma.dailyCashReport.findUnique({
    where: { businessId_date: { businessId, date } },
    include: { entries: true },
  });
  if (!report) throw new NotFoundError("Daily cash report not found");
  return mapReport(report);
}

export async function listDailyCashReports(businessId: string, limit = 30) {
  const reports = await prisma.dailyCashReport.findMany({
    where: { businessId },
    orderBy: { date: "desc" },
    take: limit,
    include: { entries: true },
  });
  return reports.map(mapReport);
}
