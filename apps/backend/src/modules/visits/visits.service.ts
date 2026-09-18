import { prisma } from "../../db/prisma";
import { NotFoundError, ValidationError } from "../../utils/errors";
import { logAudit } from "../../utils/auditLog";
import { getAccessibleLead, requireSalesOfficerProfile } from "../leads/leadAccess";
import { isValidLeadTransition } from "../leads/leadTransitions";
import type { AuthTokenPayload } from "../../utils/jwt";
import type { VisitOutcome } from "@prisma/client";

export interface VisitInput {
  scheduledAt?: string;
  visitedAt?: string;
  outcome?: VisitOutcome;
  notes?: string;
  nextFollowUpAt?: string | null;
}

// Visit outcomes that imply the lead has genuinely moved forward — used to
// nudge the lead's own status along without requiring a second manual API
// call for the common cases.
const OUTCOME_TO_LEAD_STATUS: Partial<Record<VisitOutcome, "VISIT_SCHEDULED" | "VISITED" | "APPLICATION_STARTED" | "FOLLOW_UP" | "NOT_INTERESTED">> = {
  SCHEDULED: "VISIT_SCHEDULED",
  VISITED: "VISITED",
  CUSTOMER_INTERESTED: "VISITED",
  CUSTOMER_NOT_INTERESTED: "NOT_INTERESTED",
  FOLLOW_UP_REQUIRED: "FOLLOW_UP",
  APPLICATION_STARTED: "APPLICATION_STARTED",
};

async function nudgeLeadStatus(leadId: string, outcome: VisitOutcome) {
  const nextStatus = OUTCOME_TO_LEAD_STATUS[outcome];
  if (!nextStatus) return;
  const lead = await prisma.loanLead.findUnique({ where: { id: leadId } });
  if (lead && isValidLeadTransition(lead.status, nextStatus)) {
    await prisma.loanLead.update({ where: { id: leadId }, data: { status: nextStatus } });
  }
}

export async function createVisit(auth: AuthTokenPayload, leadId: string, input: VisitInput) {
  await getAccessibleLead(auth, leadId);
  const profile = await requireSalesOfficerProfile(auth.userId);

  const outcome = input.outcome ?? "SCHEDULED";

  const visit = await prisma.visitRecord.create({
    data: {
      leadId,
      salesOfficerId: profile.id,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      visitedAt: input.visitedAt ? new Date(input.visitedAt) : null,
      outcome,
      notes: input.notes,
      nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null,
    },
  });

  await nudgeLeadStatus(leadId, outcome);
  await logAudit(auth.userId, "VISIT_CREATED", "LoanLead", leadId, { visitId: visit.id, outcome });

  return visit;
}

export async function updateVisit(auth: AuthTokenPayload, visitId: string, input: VisitInput) {
  const visit = await prisma.visitRecord.findUnique({ where: { id: visitId } });
  if (!visit) throw new NotFoundError("Visit not found");

  // Ownership check flows through the same lead-access gate as everything else.
  await getAccessibleLead(auth, visit.leadId);

  if (auth.role === "SALES_OFFICER") {
    const profile = await requireSalesOfficerProfile(auth.userId);
    if (visit.salesOfficerId !== profile.id) {
      throw new ValidationError("You can only update your own visit records");
    }
  }

  const updated = await prisma.visitRecord.update({
    where: { id: visitId },
    data: {
      scheduledAt: input.scheduledAt !== undefined ? (input.scheduledAt ? new Date(input.scheduledAt) : null) : undefined,
      visitedAt: input.visitedAt !== undefined ? (input.visitedAt ? new Date(input.visitedAt) : null) : undefined,
      outcome: input.outcome,
      notes: input.notes,
      nextFollowUpAt:
        input.nextFollowUpAt !== undefined ? (input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null) : undefined,
    },
  });

  if (input.outcome) {
    await nudgeLeadStatus(visit.leadId, input.outcome);
  }
  await logAudit(auth.userId, "VISIT_UPDATED", "LoanLead", visit.leadId, { visitId, outcome: input.outcome });

  return updated;
}

export async function listVisitsForLead(auth: AuthTokenPayload, leadId: string) {
  await getAccessibleLead(auth, leadId);
  return prisma.visitRecord.findMany({ where: { leadId }, orderBy: { createdAt: "desc" }, include: { salesOfficer: true } });
}

export async function getVisit(auth: AuthTokenPayload, visitId: string) {
  const visit = await prisma.visitRecord.findUnique({ where: { id: visitId }, include: { salesOfficer: true } });
  if (!visit) throw new NotFoundError("Visit not found");
  await getAccessibleLead(auth, visit.leadId);
  return visit;
}

export async function listUpcomingFollowUps(auth: AuthTokenPayload) {
  if (auth.role === "SALES_OFFICER") {
    const profile = await requireSalesOfficerProfile(auth.userId);
    return prisma.visitRecord.findMany({
      where: { salesOfficerId: profile.id, nextFollowUpAt: { not: null } },
      orderBy: { nextFollowUpAt: "asc" },
      include: { lead: true },
    });
  }

  // ADMIN sees every upcoming follow-up across all officers.
  return prisma.visitRecord.findMany({
    where: { nextFollowUpAt: { not: null } },
    orderBy: { nextFollowUpAt: "asc" },
    include: { lead: true, salesOfficer: true },
  });
}
