import { Prisma, type KaiActionDraft, type KaiActionKind } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { env } from "../config/env";
import { toNumber } from "../utils/decimal";
import { computeStatus } from "../utils/transactionStatus";
import { AppError, ConflictError, NotFoundError, ValidationError } from "../utils/errors";
import { logAudit } from "../utils/auditLog";
import { MAX_LEDGER_AMOUNT } from "./numbers";
import type { KaiDraftView } from "./types";

/**
 * Kai's safe writes (KAI principle 5). Kai only ever proposes a typed, validated draft; nothing is written until the
 * owner confirms it (POST /kai/actions/:id/confirm). Confirming runs in one database transaction, at most once
 * (the draft row is the idempotency key, plus an optional client Idempotency-Key), and Kai says "saved" only after
 * the transaction has committed. Model output never reaches this file.
 */

const amount = z.number().positive().max(MAX_LEDGER_AMOUNT).multipleOf(0.01);
const name = z.string().trim().min(2).max(150);

export const draftPayloadSchemas = {
  ADD_CREDIT: z.object({ partyId: z.string().uuid().optional(), newPartyName: name.optional(), partyName: name, amount, description: z.string().max(500).optional() })
    .refine((p) => Boolean(p.partyId) !== Boolean(p.newPartyName), "exactly one of partyId / newPartyName"),
  ADD_DEBIT: z.object({ partyId: z.string().uuid().optional(), newPartyName: name.optional(), partyName: name, amount, description: z.string().max(500).optional() })
    .refine((p) => Boolean(p.partyId) !== Boolean(p.newPartyName), "exactly one of partyId / newPartyName"),
  RECORD_PAYMENT: z.object({ partyKind: z.enum(["CUSTOMER", "SUPPLIER"]), partyId: z.string().uuid(), partyName: name, amount, note: z.string().max(300).optional() }),
  SAVE_MEMORY: z.object({ memoryId: z.string().uuid(), kind: z.enum(["PREFERENCE", "ALIAS", "NOTE"]), key: z.string().min(1).max(100), value: z.string().min(1).max(300) }),
} as const;

export type DraftPayload<K extends KaiActionKind> = z.infer<(typeof draftPayloadSchemas)[K]>;

export function draftView(d: Pick<KaiActionDraft, "id" | "kind" | "summary" | "warnings" | "expiresAt">): KaiDraftView {
  return {
    id: d.id,
    kind: d.kind,
    summary: d.summary,
    warnings: Array.isArray(d.warnings) ? (d.warnings as string[]) : [],
    expiresAt: d.expiresAt.toISOString(),
  };
}

export async function createDraft<K extends KaiActionKind>(args: {
  businessId: string;
  userId: string;
  conversationId: string;
  kind: K;
  payload: DraftPayload<K>;
  summary: string;
  warnings?: string[];
  now: Date;
}): Promise<KaiActionDraft> {
  const payload = draftPayloadSchemas[args.kind].parse(args.payload);
  // One open draft per conversation: a new one replaces the one before (the owner moved on).
  await prisma.kaiActionDraft.updateMany({
    where: { businessId: args.businessId, conversationId: args.conversationId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  return prisma.kaiActionDraft.create({
    data: {
      businessId: args.businessId,
      userId: args.userId,
      conversationId: args.conversationId,
      kind: args.kind,
      payload: payload as Prisma.InputJsonValue,
      summary: args.summary,
      warnings: (args.warnings ?? []) as Prisma.InputJsonValue,
      expiresAt: new Date(args.now.getTime() + env.KAI_DRAFT_TTL_MINUTES * 60 * 1000),
    },
  });
}

export interface ConfirmResult {
  draft: KaiActionDraft;
  replayed: boolean;
  result: Record<string, unknown>;
}

type Tx = Prisma.TransactionClient;

async function partyId(tx: Tx, businessId: string, kind: "CUSTOMER" | "SUPPLIER", p: { partyId?: string; newPartyName?: string }): Promise<string> {
  if (p.partyId) {
    const found =
      kind === "CUSTOMER"
        ? await tx.customer.findFirst({ where: { id: p.partyId, businessId }, select: { id: true } })
        : await tx.supplier.findFirst({ where: { id: p.partyId, businessId }, select: { id: true } });
    if (!found) throw new NotFoundError(kind === "CUSTOMER" ? "Customer not found" : "Supplier not found");
    return found.id;
  }
  const newName = p.newPartyName!.trim();
  const existing =
    kind === "CUSTOMER"
      ? await tx.customer.findFirst({ where: { businessId, name: { equals: newName, mode: "insensitive" } }, select: { id: true } })
      : await tx.supplier.findFirst({ where: { businessId, name: { equals: newName, mode: "insensitive" } }, select: { id: true } });
  if (existing) return existing.id;
  const created =
    kind === "CUSTOMER"
      ? await tx.customer.create({ data: { businessId, name: newName }, select: { id: true } })
      : await tx.supplier.create({ data: { businessId, name: newName }, select: { id: true } });
  return created.id;
}

/** Spreads a payment over the person's pending entries, oldest first; refuses more than is pending. */
async function applyPayment(tx: Tx, businessId: string, p: DraftPayload<"RECORD_PAYMENT">): Promise<Record<string, unknown>> {
  const customer = p.partyKind === "CUSTOMER";
  const rows = customer
    ? await tx.creditTransaction.findMany({
        where: { businessId, customerId: p.partyId, status: { not: "PAID" } },
        select: { id: true, amount: true, paidAmount: true, transactionDate: true, createdAt: true },
      })
    : await tx.debitTransaction.findMany({
        where: { businessId, supplierId: p.partyId, status: { not: "PAID" } },
        select: { id: true, amount: true, paidAmount: true, transactionDate: true, createdAt: true },
      });
  rows.sort((a, b) => (a.transactionDate ?? a.createdAt).getTime() - (b.transactionDate ?? b.createdAt).getTime());
  const cents = (v: number) => Math.round(v * 100);
  const pending = rows.reduce((s, r) => s + cents(toNumber(r.amount)) - cents(toNumber(r.paidAmount)), 0);
  let left = cents(p.amount);
  if (left > pending) throw new ValidationError(`Payment is more than the pending balance of ${pending / 100}`);
  const applied: { entryId: string; amount: number }[] = [];
  for (const r of rows) {
    if (left <= 0) break;
    const total = cents(toNumber(r.amount));
    const paid = cents(toNumber(r.paidAmount));
    const take = Math.min(total - paid, left);
    if (take <= 0) continue;
    const newPaid = (paid + take) / 100;
    const data = { paidAmount: newPaid, status: computeStatus(total / 100, newPaid) };
    // Only if nobody changed the entry since it was read (no lost update).
    const updated = customer
      ? await tx.creditTransaction.updateMany({ where: { id: r.id, businessId, paidAmount: r.paidAmount }, data })
      : await tx.debitTransaction.updateMany({ where: { id: r.id, businessId, paidAmount: r.paidAmount }, data });
    if (updated.count !== 1) throw new ConflictError("The entry changed while saving. Please try again.");
    await tx.payment.create({
      data: { amount: take / 100, note: p.note ?? "Kai", ...(customer ? { creditTransactionId: r.id } : { debitTransactionId: r.id }) },
    });
    applied.push({ entryId: r.id, amount: take / 100 });
    left -= take;
  }
  return { entityType: "Payment", partyId: p.partyId, partyKind: p.partyKind, amount: p.amount, applied };
}

async function execute(tx: Tx, draft: KaiActionDraft, now: Date): Promise<Record<string, unknown>> {
  const { businessId } = draft;
  switch (draft.kind) {
    case "ADD_CREDIT": {
      const p = draftPayloadSchemas.ADD_CREDIT.parse(draft.payload);
      const customerId = await partyId(tx, businessId, "CUSTOMER", p);
      const row = await tx.creditTransaction.create({
        data: { businessId, customerId, amount: p.amount, description: p.description, transactionDate: now },
        select: { id: true },
      });
      return { entityType: "CreditTransaction", entityId: row.id, partyId: customerId, partyKind: "CUSTOMER", amount: p.amount };
    }
    case "ADD_DEBIT": {
      const p = draftPayloadSchemas.ADD_DEBIT.parse(draft.payload);
      const supplierId = await partyId(tx, businessId, "SUPPLIER", p);
      const row = await tx.debitTransaction.create({
        data: { businessId, supplierId, amount: p.amount, description: p.description, transactionDate: now },
        select: { id: true },
      });
      return { entityType: "DebitTransaction", entityId: row.id, partyId: supplierId, partyKind: "SUPPLIER", amount: p.amount };
    }
    case "RECORD_PAYMENT":
      return applyPayment(tx, businessId, draftPayloadSchemas.RECORD_PAYMENT.parse(draft.payload));
    case "SAVE_MEMORY": {
      const p = draftPayloadSchemas.SAVE_MEMORY.parse(draft.payload);
      const memory = await tx.kaiMemory.findFirst({ where: { id: p.memoryId, businessId } });
      if (!memory) throw new NotFoundError("Memory not found");
      // A new reply language / nickname replaces the old one.
      if (p.kind !== "NOTE") {
        await tx.kaiMemory.updateMany({
          where: { businessId, kind: p.kind, key: { equals: p.key, mode: "insensitive" }, status: "APPROVED", id: { not: memory.id } },
          data: { status: "REJECTED" },
        });
      }
      await tx.kaiMemory.update({ where: { id: memory.id }, data: { status: "APPROVED", approvedAt: now } });
      return { entityType: "KaiMemory", entityId: memory.id, kind: p.kind };
    }
  }
}

export async function confirmDraft(businessId: string, userId: string, draftId: string, confirmKey: string | undefined, now: Date): Promise<ConfirmResult> {
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      // Claim the draft: only one confirm can move it out of PENDING (a second, concurrent one waits, then sees EXECUTED).
      const claimed = await tx.kaiActionDraft.updateMany({
        where: { id: draftId, businessId, status: "PENDING", expiresAt: { gt: now } },
        data: { status: "EXECUTED", executedAt: now, confirmKey: confirmKey ?? null },
      });
      if (claimed.count === 0) {
        const existing = await tx.kaiActionDraft.findFirst({ where: { id: draftId, businessId } });
        if (!existing) throw new NotFoundError("Draft not found");
        if (existing.status === "EXECUTED") {
          if (confirmKey && existing.confirmKey && existing.confirmKey !== confirmKey) {
            throw new ConflictError("This draft was already confirmed with a different Idempotency-Key");
          }
          return { draft: existing, replayed: true, result: (existing.result ?? {}) as Record<string, unknown> };
        }
        if (existing.status === "PENDING") throw new AppError(409, "DRAFT_EXPIRED", "This draft expired. Ask Kai again.");
        throw new AppError(409, `DRAFT_${existing.status}`, `This draft was ${existing.status.toLowerCase()}.`);
      }
      const draft = await tx.kaiActionDraft.findUniqueOrThrow({ where: { id: draftId } });
      const result = await execute(tx, draft, now);
      const saved = await tx.kaiActionDraft.update({ where: { id: draftId }, data: { result: result as Prisma.InputJsonValue } });
      return { draft: saved, replayed: false, result };
    });
    if (!outcome.replayed) {
      await logAudit(userId, "KAI_ACTION_CONFIRMED", "KaiActionDraft", draftId, { kind: outcome.draft.kind, result: outcome.result });
    }
    return outcome;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConflictError("This Idempotency-Key was already used for another action");
    }
    // A validation failure inside the transaction rolled everything back; the draft can't run as it is.
    if (err instanceof ValidationError || (err instanceof NotFoundError && err.message !== "Draft not found")) {
      await prisma.kaiActionDraft.updateMany({ where: { id: draftId, businessId, status: "PENDING" }, data: { status: "FAILED", error: err.message } });
    }
    throw err;
  }
}

export async function cancelDraft(businessId: string, draftId: string): Promise<KaiActionDraft> {
  const draft = await prisma.kaiActionDraft.findFirst({ where: { id: draftId, businessId } });
  if (!draft) throw new NotFoundError("Draft not found");
  if (draft.status === "CANCELLED") return draft;
  if (draft.status !== "PENDING") throw new AppError(409, `DRAFT_${draft.status}`, `This draft was ${draft.status.toLowerCase()}.`);
  const cancelled = await prisma.kaiActionDraft.update({ where: { id: draftId }, data: { status: "CANCELLED" } });
  if (draft.kind === "SAVE_MEMORY") {
    const memoryId = (draft.payload as { memoryId?: string }).memoryId;
    if (memoryId) await prisma.kaiMemory.updateMany({ where: { id: memoryId, businessId, status: "PENDING" }, data: { status: "REJECTED" } });
  }
  return cancelled;
}
