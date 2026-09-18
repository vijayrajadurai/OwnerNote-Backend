import type { BusinessCategory, LeadStatus, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ValidationError } from "../../utils/errors";
import { logAudit } from "../../utils/auditLog";
import type { AuthTokenPayload } from "../../utils/jwt";
import { getAccessibleLead, getSalesOfficerProfileForUser } from "./leadAccess";
import { isValidLeadTransition } from "./leadTransitions";

export type LeadSortField = "leadScore" | "createdAt" | "city" | "status";
export type SortDirection = "asc" | "desc";

export interface LeadListParams {
  page?: number;
  limit?: number;
  status?: LeadStatus;
  search?: string;
  category?: BusinessCategory;
  city?: string;
  assignedSalesOfficerId?: string;
  unassignedOnly?: boolean;
  minScore?: number;
  maxScore?: number;
  fromDate?: string;
  toDate?: string;
  sortBy?: LeadSortField;
  sortDir?: SortDirection;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export async function listLeads(auth: AuthTokenPayload, params: LeadListParams) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));

  const where: Prisma.LoanLeadWhereInput = {};

  if (params.status) where.status = params.status;
  if (params.category) where.businessCategory = params.category;
  if (params.city) where.city = { equals: params.city, mode: "insensitive" };
  if (params.minScore !== undefined || params.maxScore !== undefined) {
    where.leadScore = {
      ...(params.minScore !== undefined ? { gte: params.minScore } : {}),
      ...(params.maxScore !== undefined ? { lte: params.maxScore } : {}),
    };
  }
  if (params.fromDate || params.toDate) {
    where.createdAt = {
      ...(params.fromDate ? { gte: new Date(params.fromDate) } : {}),
      ...(params.toDate ? { lte: new Date(params.toDate) } : {}),
    };
  }
  if (params.search) {
    where.OR = [
      { businessName: { contains: params.search, mode: "insensitive" } },
      { ownerName: { contains: params.search, mode: "insensitive" } },
      { phone: { contains: params.search } },
    ];
  }

  if (auth.role === "SALES_OFFICER") {
    const profile = await getSalesOfficerProfileForUser(auth.userId);
    // No profile yet -> this officer has never been set up to see leads.
    if (!profile) return { items: [], page, limit, total: 0, totalPages: 0 };
    where.assignments = { some: { salesOfficerId: profile.id, active: true } };
  } else if (auth.role === "ADMIN") {
    if (params.assignedSalesOfficerId) {
      where.assignments = { some: { salesOfficerId: params.assignedSalesOfficerId, active: true } };
    } else if (params.unassignedOnly) {
      where.assignments = { none: { active: true } };
    }
  }

  const sortDir = params.sortDir ?? "desc";
  const orderBy: Prisma.LoanLeadOrderByWithRelationInput[] = params.sortBy
    ? [{ [params.sortBy]: sortDir }, { createdAt: "desc" }]
    : [{ leadScore: "desc" }, { createdAt: "desc" }];

  const [items, total] = await Promise.all([
    prisma.loanLead.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: { assignments: { where: { active: true }, include: { salesOfficer: true } } },
    }),
    prisma.loanLead.count({ where }),
  ]);

  return { items, page, limit, total, totalPages: Math.ceil(total / limit) || 0 };
}

// Leads that are effectively closed and no longer belong on a working queue.
const CLOSED_STATUSES: LeadStatus[] = ["DISBURSED", "REJECTED"];
const URGENCY_WEIGHT: Record<string, number> = { HIGH: 2, MEDIUM: 1, LOW: 0 };
const HIGH_INTENT_SCORE_THRESHOLD = 70;

/**
 * A sales officer's prioritized work queue: high intent -> urgency ->
 * has an explicit callback preference -> soonest funding-opportunity
 * expiry -> lead score. preferredCallbackTime is free text (not a
 * parseable timestamp), so it's used as a boost rather than a
 * chronological sort key.
 */
export async function getWorkQueue(auth: AuthTokenPayload) {
  const profile = await getSalesOfficerProfileForUser(auth.userId);
  if (!profile) return [];

  const leads = await prisma.loanLead.findMany({
    where: {
      assignments: { some: { salesOfficerId: profile.id, active: true } },
      status: { notIn: CLOSED_STATUSES },
    },
    include: { opportunity: true },
  });

  return leads
    .map((lead) => ({
      lead,
      isHighIntent: lead.leadScore >= HIGH_INTENT_SCORE_THRESHOLD,
      urgencyWeight: lead.opportunity ? URGENCY_WEIGHT[lead.opportunity.urgency] ?? 0 : 0,
      hasCallbackPreference: Boolean(lead.preferredCallbackTime),
      expiresAt: lead.opportunity?.expiresAt ?? null,
    }))
    .sort((a, b) => {
      if (a.isHighIntent !== b.isHighIntent) return a.isHighIntent ? -1 : 1;
      if (a.urgencyWeight !== b.urgencyWeight) return b.urgencyWeight - a.urgencyWeight;
      if (a.hasCallbackPreference !== b.hasCallbackPreference) return a.hasCallbackPreference ? -1 : 1;
      if (a.expiresAt !== b.expiresAt) {
        if (!a.expiresAt) return 1;
        if (!b.expiresAt) return -1;
        return a.expiresAt.getTime() - b.expiresAt.getTime();
      }
      return b.lead.leadScore - a.lead.leadScore;
    })
    .map((entry) => entry.lead);
}

/**
 * The FO dashboard's headline counts. All computed server-side from real
 * rows so the dashboard can never drift from what listLeads/work-queue/
 * follow-ups actually show — "today's calls" in particular comes from the
 * audit trail (a LEAD_STATUS_CHANGED entry moving a lead to CONTACTED
 * today), since there's no separate call-log entity.
 */
export async function getFoSummary(auth: AuthTokenPayload) {
  const profile = await getSalesOfficerProfileForUser(auth.userId);
  if (!profile) {
    return { newLeads: 0, highIntentLeads: 0, todaysCalls: 0, todaysVisits: 0, upcomingFollowUps: 0 };
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const assignedActive: Prisma.LoanLeadWhereInput = {
    assignments: { some: { salesOfficerId: profile.id, active: true } },
  };

  const [newLeads, highIntentLeads, todaysVisits, todaysCalls, upcomingFollowUps] = await Promise.all([
    prisma.loanLead.count({ where: { ...assignedActive, status: "NEW" } }),
    prisma.loanLead.count({ where: { ...assignedActive, leadScore: { gte: HIGH_INTENT_SCORE_THRESHOLD } } }),
    prisma.visitRecord.count({
      where: { salesOfficerId: profile.id, scheduledAt: { gte: todayStart, lte: todayEnd } },
    }),
    prisma.auditLog.count({
      where: {
        actorUserId: auth.userId,
        action: "LEAD_STATUS_CHANGED",
        createdAt: { gte: todayStart, lte: todayEnd },
        metadata: { path: ["to"], equals: "CONTACTED" },
      },
    }),
    prisma.visitRecord.count({ where: { salesOfficerId: profile.id, nextFollowUpAt: { not: null } } }),
  ]);

  return { newLeads, highIntentLeads, todaysCalls, todaysVisits, upcomingFollowUps };
}

export async function getLeadDetail(auth: AuthTokenPayload, leadId: string) {
  await getAccessibleLead(auth, leadId);
  return prisma.loanLead.findUnique({
    where: { id: leadId },
    include: {
      assignments: { orderBy: { createdAt: "desc" }, include: { salesOfficer: true, assignedBy: true } },
      visits: { orderBy: { createdAt: "desc" } },
      opportunity: true,
    },
  });
}

export async function updateLeadStatus(auth: AuthTokenPayload, leadId: string, nextStatus: LeadStatus) {
  const lead = await getAccessibleLead(auth, leadId);

  if (!isValidLeadTransition(lead.status, nextStatus)) {
    throw new ValidationError(`Cannot move a lead from ${lead.status} to ${nextStatus}`);
  }

  const updated = await prisma.loanLead.update({ where: { id: leadId }, data: { status: nextStatus } });

  await logAudit(auth.userId, "LEAD_STATUS_CHANGED", "LoanLead", leadId, {
    from: lead.status,
    to: nextStatus,
  });

  return updated;
}
