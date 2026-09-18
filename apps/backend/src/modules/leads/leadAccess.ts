import { prisma } from "../../db/prisma";
import { ForbiddenError, NotFoundError } from "../../utils/errors";
import type { AuthTokenPayload } from "../../utils/jwt";

export async function getSalesOfficerProfileForUser(userId: string) {
  return prisma.salesOfficerProfile.findUnique({ where: { userId } });
}

export async function requireSalesOfficerProfile(userId: string) {
  const profile = await getSalesOfficerProfileForUser(userId);
  if (!profile) throw new NotFoundError("Sales officer profile not found");
  return profile;
}

/**
 * Ownership gate shared by leads/assignments/visits: ADMIN can reach any
 * lead, SALES_OFFICER only a lead with an active assignment to their own
 * profile. Returns 404 (not 403) on a cross-officer attempt so a sales
 * officer can't tell the difference between "not yours" and "doesn't
 * exist" by probing ids — same pattern used for owner-scoped resources
 * elsewhere in this backend.
 */
export async function getAccessibleLead(auth: AuthTokenPayload, leadId: string) {
  if (auth.role === "ADMIN") {
    const lead = await prisma.loanLead.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundError("Lead not found");
    return lead;
  }

  if (auth.role === "SALES_OFFICER") {
    const profile = await getSalesOfficerProfileForUser(auth.userId);
    if (!profile) throw new NotFoundError("Lead not found");
    const lead = await prisma.loanLead.findFirst({
      where: { id: leadId, assignments: { some: { salesOfficerId: profile.id, active: true } } },
    });
    if (!lead) throw new NotFoundError("Lead not found");
    return lead;
  }

  throw new ForbiddenError("You do not have access to leads");
}
