import type { KaiMemory, KaiMemoryKind } from "@prisma/client";
import { prisma } from "../db/prisma";
import type { KaiFact, KaiIntent, KaiLang, KaiTurnContext, PartyRef, PendingChoice, ProductRef } from "./types";

/**
 * Kai's memory (KAI principle 4). Three kinds, all per business:
 *  - the conversation (KaiMessage) and a rolling summary of it (KaiConversation.summary);
 *  - what the owner approved Kai to keep (KaiMemory: a reply language, a nickname for a person, a note) — PENDING
 *    until the owner confirms, and never a source of numbers;
 *  - corrections ("that's wrong"), kept with their source, time and how they compare with the records.
 * Nothing here retrains a model; replies say so plainly.
 */

export interface ApprovedMemory {
  id: string;
  kind: KaiMemoryKind;
  key: string;
  value: string;
}

export async function approvedMemories(businessId: string): Promise<ApprovedMemory[]> {
  const rows = await prisma.kaiMemory.findMany({
    where: { businessId, status: "APPROVED" },
    orderBy: { approvedAt: "desc" },
    take: 200,
    select: { id: true, kind: true, key: true, value: true },
  });
  return rows;
}

export function aliasesOf(memories: ApprovedMemory[]): { alias: string; partyName: string }[] {
  return memories.filter((m) => m.kind === "ALIAS").map((m) => ({ alias: m.key, partyName: m.value }));
}

export function replyLanguageOf(memories: ApprovedMemory[]): KaiLang | undefined {
  const pref = memories.find((m) => m.kind === "PREFERENCE" && m.key === "reply_language");
  return pref && ["TAMIL", "TANGLISH", "ENGLISH"].includes(pref.value) ? (pref.value as KaiLang) : undefined;
}

/** Simple retrieval over the owner's approved memory: the entries sharing the most words with the question. */
export function searchMemories(memories: ApprovedMemory[], query: string, limit = 5): ApprovedMemory[] {
  const words = new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3));
  if (words.size === 0) return memories.slice(0, limit);
  const scored = memories
    .map((m) => {
      const text = `${m.key} ${m.value}`.toLowerCase();
      let score = 0;
      for (const w of words) if (text.includes(w)) score++;
      return { m, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return (scored.length > 0 ? scored.map((x) => x.m) : memories).slice(0, limit);
}

export async function createPendingMemory(
  businessId: string,
  userId: string,
  memory: { kind: KaiMemoryKind; key: string; value: string },
  source: string,
): Promise<KaiMemory> {
  return prisma.kaiMemory.create({ data: { businessId, userId, ...memory, status: "PENDING", source } });
}

/** What the next turn needs from this one, saved on the assistant message. */
export interface TurnMeta {
  lastParty?: PartyRef;
  lastProduct?: ProductRef;
  choice?: PendingChoice;
  awaitingAmount?: { intent: KaiIntent; party: PartyRef | { newName: string; kind: PartyRef["kind"] } };
  sideAsked?: boolean;
  facts?: KaiFact[];
  draftId?: string;
}

export async function loadTurnContext(
  conversationId: string,
  businessId: string,
  now: Date,
): Promise<{ turn: KaiTurnContext; meta: TurnMeta }> {
  const last = await prisma.kaiMessage.findMany({
    where: { conversationId, businessId, role: "ASSISTANT" },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { id: true, text: true, intent: true, meta: true, lang: true },
  });
  const turn: KaiTurnContext = {};
  const latest = last[0];
  const latestMeta = (latest?.meta ?? {}) as TurnMeta;
  // The person / product talked about most recently, from any of the last few replies.
  for (const m of last) {
    const meta = (m.meta ?? {}) as TurnMeta;
    turn.lastParty ??= meta.lastParty;
    turn.lastProduct ??= meta.lastProduct;
  }
  if (latest) {
    turn.lastIntent = (latest.intent ?? undefined) as KaiIntent | undefined;
    turn.lastLang = latest.lang as KaiLang;
    turn.lastAnswer = { messageId: latest.id, text: latest.text, intent: turn.lastIntent ?? "UNCLEAR", facts: latestMeta.facts ?? [] };
    turn.choice = latestMeta.choice;
    turn.sideAsked = latestMeta.sideAsked === true;
  }
  const draft = await prisma.kaiActionDraft.findFirst({
    where: { conversationId, businessId, status: "PENDING", expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { id: true, kind: true, payload: true },
  });
  if (draft) {
    const amount = (draft.payload as { amount?: unknown }).amount;
    turn.pendingDraft = { id: draft.id, kind: draft.kind, amount: typeof amount === "number" ? amount : undefined };
  }
  return { turn, meta: latestMeta };
}

/** "People: Kumar, Ravi Traders · Products: Rice · Topics: balance, stock" — the latest ten of each. */
export function nextSummary(previous: string | null, add: { person?: string; product?: string; topic?: string }): string {
  const parts = new Map<string, string[]>([
    ["People", []],
    ["Products", []],
    ["Topics", []],
  ]);
  for (const section of (previous ?? "").split(" · ")) {
    const [label, list] = section.split(": ");
    if (parts.has(label) && list) parts.set(label, list.split(", ").filter(Boolean));
  }
  const push = (label: string, value?: string) => {
    if (!value) return;
    const list = parts.get(label)!.filter((v) => v !== value);
    parts.set(label, [value, ...list].slice(0, 10));
  };
  push("People", add.person);
  push("Products", add.product);
  push("Topics", add.topic);
  return [...parts.entries()]
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => `${label}: ${list.join(", ")}`)
    .join(" · ");
}
