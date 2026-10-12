import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { env } from "../config/env";
import * as businessService from "../modules/business/business.service";
import { NotFoundError, UnauthorizedError } from "../utils/errors";
import { logAudit } from "../utils/auditLog";
import { cancelDraft, confirmDraft, draftView } from "./actions";
import { chat, RULE_BASED_LABEL, savedReply } from "./engine";
import { kaiModel } from "./model";
import type { KaiLang } from "./types";

async function owner(req: Request): Promise<{ userId: string; businessId: string }> {
  if (!req.auth) throw new UnauthorizedError();
  const business = await businessService.getBusinessForUser(req.auth.userId);
  return { userId: req.auth.userId, businessId: business.id };
}

const chatSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  conversationId: z.string().uuid().optional(),
});

export async function postChat(req: Request, res: Response): Promise<void> {
  const { userId, businessId } = await owner(req);
  const body = chatSchema.parse(req.body);
  const reply = await chat({ userId, businessId, message: body.message, conversationId: body.conversationId });
  res.status(200).json({ data: reply });
}

export async function getStatus(_req: Request, res: Response): Promise<void> {
  const model = kaiModel();
  const reachable = model.enabled ? await model.ping() : false;
  res.status(200).json({
    data: {
      mode: model.enabled && reachable ? "local-model" : "rule-based",
      label: model.enabled && reachable ? `Local AI model (${model.name}) — facts come from your records` : RULE_BASED_LABEL,
      provider: model.provider,
      model: model.enabled ? model.name : null,
      modelReachable: reachable,
      historyRetentionDays: env.KAI_HISTORY_RETENTION_DAYS,
    },
  });
}

export async function listConversations(req: Request, res: Response): Promise<void> {
  const { userId, businessId } = await owner(req);
  const rows = await prisma.kaiConversation.findMany({
    where: { businessId, userId },
    orderBy: { lastMessageAt: "desc" },
    take: 30,
    select: { id: true, summary: true, lastMessageAt: true, createdAt: true },
  });
  res.status(200).json({ data: rows });
}

async function ownConversation(req: Request) {
  const { userId, businessId } = await owner(req);
  const id = z.string().uuid().parse(req.params.id);
  const conversation = await prisma.kaiConversation.findFirst({ where: { id, businessId, userId } });
  if (!conversation) throw new NotFoundError("Conversation not found");
  return { userId, businessId, conversation };
}

export async function listMessages(req: Request, res: Response): Promise<void> {
  const { conversation } = await ownConversation(req);
  const rows = await prisma.kaiMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    take: 500,
    select: { id: true, role: true, text: true, lang: true, intent: true, engine: true, createdAt: true },
  });
  res.status(200).json({ data: rows });
}

export async function deleteConversation(req: Request, res: Response): Promise<void> {
  const { userId, conversation } = await ownConversation(req);
  await prisma.kaiConversation.delete({ where: { id: conversation.id } });
  await logAudit(userId, "KAI_CONVERSATION_DELETED", "KaiConversation", conversation.id);
  res.status(204).send();
}

const idempotencyKey = z.string().trim().min(8).max(100).optional();

export async function confirmAction(req: Request, res: Response): Promise<void> {
  const { userId, businessId } = await owner(req);
  const id = z.string().uuid().parse(req.params.id);
  const key = idempotencyKey.parse(req.header("Idempotency-Key") ?? undefined);
  const now = new Date();
  const outcome = await confirmDraft(businessId, userId, id, key, now);
  const lastUser = outcome.draft.conversationId
    ? await prisma.kaiMessage.findFirst({ where: { conversationId: outcome.draft.conversationId, role: "USER" }, orderBy: { createdAt: "desc" }, select: { lang: true } })
    : null;
  const lang = (lastUser?.lang ?? "TANGLISH") as KaiLang;
  // Said only now: the transaction above has committed.
  const reply = await savedReply(businessId, outcome.draft, outcome.result, lang, now);
  if (!outcome.replayed && outcome.draft.conversationId) {
    await prisma.kaiMessage.create({
      data: {
        conversationId: outcome.draft.conversationId,
        businessId,
        role: "ASSISTANT",
        text: reply,
        lang,
        intent: "CONFIRMED",
        engine: "rule-based",
        meta: { draftId: outcome.draft.id },
      },
    });
  }
  res.status(200).json({ data: { status: outcome.draft.status, replayed: outcome.replayed, reply, result: outcome.result } });
}

export async function cancelAction(req: Request, res: Response): Promise<void> {
  const { businessId } = await owner(req);
  const id = z.string().uuid().parse(req.params.id);
  const draft = await cancelDraft(businessId, id);
  res.status(200).json({ data: { ...draftView(draft), status: draft.status } });
}

const memoryQuery = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]).default("APPROVED") });

export async function listMemories(req: Request, res: Response): Promise<void> {
  const { businessId } = await owner(req);
  const { status } = memoryQuery.parse(req.query);
  const rows = await prisma.kaiMemory.findMany({
    where: { businessId, status },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { id: true, kind: true, key: true, value: true, status: true, source: true, approvedAt: true, createdAt: true },
  });
  res.status(200).json({ data: rows });
}

export async function deleteMemory(req: Request, res: Response): Promise<void> {
  const { userId, businessId } = await owner(req);
  const id = z.string().uuid().parse(req.params.id);
  const deleted = await prisma.kaiMemory.deleteMany({ where: { id, businessId } });
  if (deleted.count === 0) throw new NotFoundError("Memory not found");
  await logAudit(userId, "KAI_MEMORY_DELETED", "KaiMemory", id);
  res.status(204).send();
}

const feedbackSchema = z.object({
  messageId: z.string().uuid(),
  rating: z.union([z.literal(1), z.literal(-1)]),
  comment: z.string().trim().max(500).optional(),
  allowTraining: z.boolean().default(false),
});

export async function postFeedback(req: Request, res: Response): Promise<void> {
  const { userId, businessId } = await owner(req);
  const body = feedbackSchema.parse(req.body);
  const message = await prisma.kaiMessage.findFirst({ where: { id: body.messageId, businessId, role: "ASSISTANT" }, select: { id: true } });
  if (!message) throw new NotFoundError("Message not found");
  const row = await prisma.kaiFeedback.upsert({
    where: { messageId_userId: { messageId: message.id, userId } },
    create: { businessId, userId, messageId: message.id, rating: body.rating, comment: body.comment, allowTraining: body.allowTraining },
    update: { rating: body.rating, comment: body.comment, allowTraining: body.allowTraining },
    select: { id: true, rating: true, allowTraining: true },
  });
  res.status(201).json({ data: row });
}

/** Phone numbers and the shop's own people's names are replaced before anything leaves for a training set. */
export function redact(text: string, names: string[]): string {
  let out = text.replace(/\+?\d[\d\s-]{8,}\d/g, "[PHONE]");
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    if (name.trim().length < 2) continue;
    out = out.split(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")).join("[NAME]");
  }
  return out;
}

const exportQuery = z.object({ limit: z.coerce.number().int().min(1).max(5000).default(1000) });

/** ADMIN only: the opted-in, redacted feedback set for evaluation / a future fine-tune. */
export async function exportFeedback(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw new UnauthorizedError();
  const { limit } = exportQuery.parse(req.query);
  const rows = await prisma.kaiFeedback.findMany({
    where: { allowTraining: true },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { message: { select: { conversationId: true, text: true, lang: true, intent: true, createdAt: true } } },
  });
  const namesByBusiness = new Map<string, string[]>();
  const out = [];
  for (const f of rows) {
    if (!namesByBusiness.has(f.businessId)) {
      const [c, s] = await Promise.all([
        prisma.customer.findMany({ where: { businessId: f.businessId }, select: { name: true } }),
        prisma.supplier.findMany({ where: { businessId: f.businessId }, select: { name: true } }),
      ]);
      namesByBusiness.set(f.businessId, [...c, ...s].map((p) => p.name));
    }
    const names = namesByBusiness.get(f.businessId)!;
    const input = await prisma.kaiMessage.findFirst({
      where: { conversationId: f.message.conversationId, role: "USER", createdAt: { lte: f.message.createdAt } },
      orderBy: { createdAt: "desc" },
      select: { text: true },
    });
    out.push({
      input: redact(input?.text ?? "", names),
      output: redact(f.message.text, names),
      lang: f.message.lang,
      intent: f.message.intent,
      rating: f.rating,
      comment: f.comment ? redact(f.comment, names) : null,
    });
  }
  await logAudit(req.auth.userId, "KAI_FEEDBACK_EXPORTED", "KaiFeedback", "export", { count: out.length });
  res.status(200).json({ data: out });
}
