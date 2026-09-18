import { prisma } from "../../db/prisma";
import { NotFoundError, ValidationError } from "../../utils/errors";
import { logAudit } from "../../utils/auditLog";
import { isValidLeadTransition } from "../leads/leadTransitions";

async function requireActiveSalesOfficer(salesOfficerId: string) {
  const officer = await prisma.salesOfficerProfile.findUnique({ where: { id: salesOfficerId } });
  if (!officer || !officer.active) throw new NotFoundError("Sales officer not found");
  return officer;
}

async function requireLead(leadId: string) {
  const lead = await prisma.loanLead.findUnique({ where: { id: leadId } });
  if (!lead) throw new NotFoundError("Lead not found");
  return lead;
}

/**
 * Assigns (or reassigns) a lead to a sales officer. Reassignment never
 * destroys history: the current active row (if any, and if it's a
 * different officer) is deactivated rather than deleted or overwritten,
 * so "who had this lead and when" is always reconstructable from
 * getAssignmentHistory.
 */
export async function assignLead(adminUserId: string, leadId: string, salesOfficerId: string) {
  const lead = await requireLead(leadId);
  await requireActiveSalesOfficer(salesOfficerId);

  const currentActive = await prisma.leadAssignment.findFirst({ where: { leadId, active: true } });

  if (currentActive?.salesOfficerId === salesOfficerId) {
    return currentActive;
  }

  const result = await prisma.$transaction(async (tx) => {
    if (currentActive) {
      await tx.leadAssignment.update({
        where: { id: currentActive.id },
        data: { active: false, unassignedAt: new Date() },
      });
    }

    const assignment = await tx.leadAssignment.create({
      data: { leadId, salesOfficerId, assignedByUserId: adminUserId },
      include: { salesOfficer: true },
    });

    if (isValidLeadTransition(lead.status, "ASSIGNED")) {
      await tx.loanLead.update({ where: { id: leadId }, data: { status: "ASSIGNED" } });
    }

    return assignment;
  });

  await logAudit(adminUserId, currentActive ? "LEAD_REASSIGNED" : "LEAD_ASSIGNED", "LoanLead", leadId, {
    salesOfficerId,
    previousSalesOfficerId: currentActive?.salesOfficerId ?? null,
  });

  return result;
}

export async function unassignLead(adminUserId: string, leadId: string) {
  await requireLead(leadId);
  const currentActive = await prisma.leadAssignment.findFirst({ where: { leadId, active: true } });
  if (!currentActive) throw new ValidationError("This lead has no active assignment");

  const updated = await prisma.leadAssignment.update({
    where: { id: currentActive.id },
    data: { active: false, unassignedAt: new Date() },
  });

  await logAudit(adminUserId, "LEAD_UNASSIGNED", "LoanLead", leadId, { salesOfficerId: currentActive.salesOfficerId });

  return updated;
}

export async function getAssignmentHistory(leadId: string) {
  await requireLead(leadId);
  return prisma.leadAssignment.findMany({
    where: { leadId },
    orderBy: { createdAt: "desc" },
    include: { salesOfficer: true, assignedBy: true },
  });
}
