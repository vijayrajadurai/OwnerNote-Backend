import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { toNumber } from "../../utils/decimal";
import { NotFoundError, ValidationError, ConflictError } from "../../utils/errors";
import { detectFundingOpportunities, getActivityStats } from "../../ai/fundingOpportunityDetector";
import { scoreLead } from "../../ai/leadScorer";
import type { FundingOpportunityCandidate, LeadQualificationInput } from "../../ai/types";

const COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
const MATERIAL_CHANGE_MULTIPLIER = 1.5;

function candidateData(candidate: FundingOpportunityCandidate) {
  return {
    title: candidate.title,
    explanation: candidate.explanation,
    estimatedRequirement: candidate.estimatedRequirement,
    estimatedAvailableCash: candidate.estimatedAvailableCash,
    estimatedGap: candidate.estimatedGap,
    urgency: candidate.urgency,
    confidence: candidate.confidence,
    signalScore: candidate.signalScore,
    sourceSignals: candidate.sourceSignals as unknown as Prisma.InputJsonValue,
    expiresAt: candidate.expiresAt ? new Date(candidate.expiresAt) : null,
  };
}

/**
 * Upserts one detected opportunity by (businessId, type, dedupeKey), same
 * pattern as Phase 4's AiInsight fix — plus the cooldown rule from spec
 * section 14: once a user says NOT_NOW, a refresh must not immediately
 * resurface the same opportunity. It only comes back after a 14-day
 * cooldown OR once the underlying gap has grown by 50%+ (a materially
 * different situation), and INTERESTED/CONVERTED_TO_LEAD are never
 * overwritten by a refresh at all.
 */
async function upsertOpportunity(businessId: string, candidate: FundingOpportunityCandidate, now: Date) {
  const key = {
    businessId_type_dedupeKey: { businessId, type: candidate.type, dedupeKey: candidate.dedupeKey },
  };
  const existing = await prisma.fundingOpportunity.findUnique({ where: key });
  const data = candidateData(candidate);

  if (!existing) {
    return prisma.fundingOpportunity.create({
      data: { businessId, type: candidate.type, dedupeKey: candidate.dedupeKey, status: "DETECTED", ...data },
    });
  }

  if (existing.status === "INTERESTED" || existing.status === "CONVERTED_TO_LEAD") {
    return existing;
  }

  if (existing.status === "NOT_NOW") {
    const cooldownOver = !!existing.respondedAt && now.getTime() - existing.respondedAt.getTime() >= COOLDOWN_MS;
    const oldGap = toNumber(existing.estimatedGap);
    const newGap = candidate.estimatedGap ?? 0;
    const materialChange = oldGap > 0 && newGap >= oldGap * MATERIAL_CHANGE_MULTIPLIER;

    if (!cooldownOver && !materialChange) {
      return existing;
    }

    return prisma.fundingOpportunity.update({
      where: { id: existing.id },
      data: { ...data, status: "DETECTED", respondedAt: null },
    });
  }

  // DETECTED, SHOWN, or EXPIRED: a normal refresh. EXPIRED gets a fresh
  // slate (expiry means time ran out, not that the user rejected it).
  const nextStatus = existing.status === "EXPIRED" ? "DETECTED" : existing.status;
  return prisma.fundingOpportunity.update({ where: { id: existing.id }, data: { ...data, status: nextStatus } });
}

async function expireStale(businessId: string, now: Date) {
  await prisma.fundingOpportunity.updateMany({
    where: { businessId, status: { in: ["DETECTED", "SHOWN"] }, expiresAt: { lt: now } },
    data: { status: "EXPIRED" },
  });
}

async function listActive(businessId: string) {
  const rows = await prisma.fundingOpportunity.findMany({
    where: { businessId, status: { in: ["DETECTED", "SHOWN"] } },
    orderBy: { signalScore: "desc" },
  });

  const toShow = rows.filter((r) => r.status === "DETECTED").map((r) => r.id);
  if (toShow.length > 0) {
    await prisma.fundingOpportunity.updateMany({ where: { id: { in: toShow } }, data: { status: "SHOWN" } });
  }

  return rows.map((r) => (toShow.includes(r.id) ? { ...r, status: "SHOWN" as const } : r));
}

export async function refreshOpportunities(businessId: string, now: Date = new Date()) {
  await expireStale(businessId, now);
  const candidates = await detectFundingOpportunities(businessId, now);
  await Promise.all(candidates.map((c) => upsertOpportunity(businessId, c, now)));
  return listActive(businessId);
}

export async function getOpportunity(businessId: string, id: string) {
  const opportunity = await prisma.fundingOpportunity.findFirst({ where: { id, businessId } });
  if (!opportunity) throw new NotFoundError("Funding opportunity not found");
  return opportunity;
}

export async function markInterested(businessId: string, id: string, now: Date = new Date()) {
  const opportunity = await getOpportunity(businessId, id);
  if (opportunity.status === "CONVERTED_TO_LEAD") return opportunity;
  return prisma.fundingOpportunity.update({ where: { id }, data: { status: "INTERESTED", respondedAt: now } });
}

export async function markNotNow(businessId: string, id: string, now: Date = new Date()) {
  const opportunity = await getOpportunity(businessId, id);
  if (opportunity.status === "CONVERTED_TO_LEAD") {
    throw new ValidationError("This opportunity has already become a lead");
  }
  return prisma.fundingOpportunity.update({ where: { id }, data: { status: "NOT_NOW", respondedAt: now } });
}

export async function createLeadFromOpportunity(
  businessId: string,
  opportunityId: string,
  qualification: LeadQualificationInput,
  now: Date = new Date(),
) {
  const opportunity = await getOpportunity(businessId, opportunityId);

  const existingLead = await prisma.loanLead.findUnique({ where: { opportunityId } });
  if (existingLead) return existingLead;

  if (opportunity.status !== "INTERESTED") {
    throw new ValidationError("Mark the opportunity as interested before creating a lead");
  }

  const business = await prisma.business.findUnique({ where: { id: businessId }, include: { owner: true } });
  if (!business) throw new NotFoundError("Business not found");

  const activity = await getActivityStats(businessId, now);
  const durationYears = business.runningSinceYear ? now.getFullYear() - business.runningSinceYear : null;

  const scoreBreakdown = scoreLead({
    opportunity: { urgency: opportunity.urgency, signalScore: opportunity.signalScore },
    qualification,
    businessDurationYears: durationYears,
    recentTransactionCount: activity.recentTransactionCount,
  });

  try {
    return await prisma.$transaction(async (tx) => {
      const lead = await tx.loanLead.create({
        data: {
          businessId,
          ownerId: business.ownerUserId,
          opportunityId,
          ownerName: business.ownerName,
          businessName: business.businessName,
          phone: business.owner.phone,
          businessCategory: business.category,
          businessDurationYears: durationYears,
          city: business.city,
          fundingRequirementMin: qualification.fundingRequirementMin ?? null,
          fundingRequirementMax: qualification.fundingRequirementMax ?? null,
          workingCapitalRequirement: qualification.workingCapitalRequirement ?? null,
          fundingReason: opportunity.title,
          preferredCallbackTime: qualification.preferredCallbackTime ?? null,
          userIntent: qualification.userIntent,
          aiDetectedReason: opportunity.explanation,
          leadScore: scoreBreakdown.total,
          leadScoreExplanation: scoreBreakdown as unknown as Prisma.InputJsonValue,
          status: "NEW",
          source: "FUNDING_OPPORTUNITY",
        },
      });

      await tx.fundingOpportunity.update({ where: { id: opportunityId }, data: { status: "CONVERTED_TO_LEAD" } });
      return lead;
    });
  } catch (err) {
    // Unique constraint on opportunityId — a concurrent duplicate request lost the race above.
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002") {
      const lead = await prisma.loanLead.findUnique({ where: { opportunityId } });
      if (lead) return lead;
    }
    throw new ConflictError("Could not create lead");
  }
}

export async function listMyLeads(businessId: string) {
  return prisma.loanLead.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } });
}
