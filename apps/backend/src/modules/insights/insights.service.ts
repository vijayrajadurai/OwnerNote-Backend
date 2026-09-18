import { prisma } from "../../db/prisma";
import { NotFoundError } from "../../utils/errors";
import { generateInsightCandidates } from "../../ai/businessInsightEngine";
import type { AiInsightCandidate } from "../../ai/types";
import type { Prisma } from "@prisma/client";

const SEVERITY_RANK: Record<string, number> = { HIGH_PRESSURE: 0, PRESSURE: 1, WATCH: 2, INFO: 3 };

/**
 * Regenerates insight candidates from live data and upserts them by
 * (businessId, type, title) — a still-relevant insight keeps its
 * read/dismissed state and id instead of spawning a duplicate row on every
 * refresh. Dismissed insights are left untouched here (never resurrected by
 * a refresh) but a fresh call still recomputes candidates so a genuinely
 * new situation is captured.
 */
export async function refreshInsights(businessId: string, now: Date = new Date()) {
  const candidates = await generateInsightCandidates(businessId, now);

  await Promise.all(candidates.map((candidate) => upsertInsight(businessId, candidate)));

  return listInsights(businessId);
}

async function upsertInsight(businessId: string, candidate: AiInsightCandidate) {
  const existing = await prisma.aiInsight.findUnique({
    where: { businessId_type_dedupeKey: { businessId, type: candidate.type, dedupeKey: candidate.dedupeKey } },
  });

  // A dismissed insight stays dismissed — refreshing must never resurrect it,
  // even though the same underlying situation is still detected.
  if (existing?.dismissedAt) return existing;

  const data = {
    title: candidate.title,
    description: candidate.description,
    severity: candidate.severity,
    confidence: candidate.confidence,
    sourceRefs: (candidate.sourceRefs ?? undefined) as Prisma.InputJsonValue | undefined,
    validUntil: candidate.validUntil ? new Date(candidate.validUntil) : null,
  };

  return prisma.aiInsight.upsert({
    where: { businessId_type_dedupeKey: { businessId, type: candidate.type, dedupeKey: candidate.dedupeKey } },
    create: { businessId, type: candidate.type, dedupeKey: candidate.dedupeKey, ...data },
    update: data,
  });
}

export async function listInsights(businessId: string, includeDismissed = false) {
  const insights = await prisma.aiInsight.findMany({
    where: { businessId, dismissedAt: includeDismissed ? undefined : null },
    orderBy: { createdAt: "desc" },
  });

  return insights.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
}

export async function markInsightRead(businessId: string, id: string) {
  const insight = await prisma.aiInsight.findFirst({ where: { id, businessId } });
  if (!insight) throw new NotFoundError("Insight not found");
  return prisma.aiInsight.update({ where: { id }, data: { readAt: new Date() } });
}

export async function dismissInsight(businessId: string, id: string) {
  const insight = await prisma.aiInsight.findFirst({ where: { id, businessId } });
  if (!insight) throw new NotFoundError("Insight not found");
  return prisma.aiInsight.update({ where: { id }, data: { dismissedAt: new Date() } });
}
