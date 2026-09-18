import { prisma } from "../../db/prisma";
import { ConflictError, NotFoundError } from "../../utils/errors";

export interface CreateSalesOfficerInput {
  phone: string;
  name: string;
  territory?: string;
}

export async function listSalesOfficers() {
  const officers = await prisma.salesOfficerProfile.findMany({
    include: { user: { select: { phone: true } } },
    orderBy: { name: "asc" },
  });

  const activeAssignmentCounts = await prisma.leadAssignment.groupBy({
    by: ["salesOfficerId"],
    where: { active: true },
    _count: { _all: true },
  });
  const countBySalesOfficer = new Map(activeAssignmentCounts.map((c) => [c.salesOfficerId, c._count._all]));

  return officers.map((o) => ({
    id: o.id,
    name: o.name,
    territory: o.territory,
    active: o.active,
    phone: o.user.phone,
    activeLeadCount: countBySalesOfficer.get(o.id) ?? 0,
  }));
}

export async function createSalesOfficer(input: CreateSalesOfficerInput) {
  const normalizedPhone = input.phone.trim();

  const existingUser = await prisma.user.findUnique({ where: { phone: normalizedPhone } });
  if (existingUser && existingUser.role !== "SALES_OFFICER") {
    throw new ConflictError("This phone number is already registered under a different role");
  }
  if (existingUser) {
    const existingProfile = await prisma.salesOfficerProfile.findUnique({ where: { userId: existingUser.id } });
    if (existingProfile) throw new ConflictError("This phone number already has a sales officer profile");
  }

  const user = existingUser ?? (await prisma.user.create({ data: { phone: normalizedPhone, role: "SALES_OFFICER" } }));

  return prisma.salesOfficerProfile.create({
    data: { userId: user.id, name: input.name, territory: input.territory },
    include: { user: { select: { phone: true } } },
  });
}

const CONTACTED_OR_LATER: string[] = [
  "CONTACTED",
  "VISIT_SCHEDULED",
  "VISITED",
  "APPLICATION_STARTED",
  "APPROVED",
  "DISBURSED",
];
const VISITED_OR_LATER: string[] = ["VISITED", "APPLICATION_STARTED", "APPROVED", "DISBURSED"];
const APPLICATION_OR_LATER: string[] = ["APPLICATION_STARTED", "APPROVED", "DISBURSED"];
const APPROVED_OR_LATER: string[] = ["APPROVED", "DISBURSED"];

export async function getSalesOfficerPerformance(salesOfficerId: string) {
  const officer = await prisma.salesOfficerProfile.findUnique({ where: { id: salesOfficerId } });
  if (!officer) throw new NotFoundError("Sales officer not found");

  const assignmentRows = await prisma.leadAssignment.findMany({
    where: { salesOfficerId },
    distinct: ["leadId"],
    select: { leadId: true },
  });
  const leadIds = assignmentRows.map((r) => r.leadId);
  const leads = leadIds.length ? await prisma.loanLead.findMany({ where: { id: { in: leadIds } }, select: { status: true } }) : [];

  const assigned = leads.length;
  const contacted = leads.filter((l) => CONTACTED_OR_LATER.includes(l.status)).length;
  const visited = leads.filter((l) => VISITED_OR_LATER.includes(l.status)).length;
  const applications = leads.filter((l) => APPLICATION_OR_LATER.includes(l.status)).length;
  const approvals = leads.filter((l) => APPROVED_OR_LATER.includes(l.status)).length;
  const disbursements = leads.filter((l) => l.status === "DISBURSED").length;

  const visitCount = await prisma.visitRecord.count({ where: { salesOfficerId } });

  return {
    salesOfficerId,
    name: officer.name,
    territory: officer.territory,
    assigned,
    contacted,
    visitsRecorded: visitCount,
    visited,
    applications,
    approvals,
    disbursements,
    conversionRate: assigned > 0 ? Math.round((disbursements / assigned) * 1000) / 10 : 0,
  };
}

export async function getAllSalesOfficerPerformance() {
  const officers = await prisma.salesOfficerProfile.findMany({ select: { id: true } });
  return Promise.all(officers.map((o) => getSalesOfficerPerformance(o.id)));
}

export async function getPipelineAnalytics() {
  const [
    totalBusinesses,
    opportunitiesDetected,
    interestedOrConverted,
    totalLeads,
    leads,
    activeAssignedLeadCount,
    visitsCompletedCount,
  ] = await Promise.all([
    prisma.business.count(),
    prisma.fundingOpportunity.count(),
    prisma.fundingOpportunity.count({ where: { status: { in: ["INTERESTED", "CONVERTED_TO_LEAD"] } } }),
    prisma.loanLead.count(),
    prisma.loanLead.findMany({
      select: { status: true, leadScore: true, createdAt: true, opportunity: { select: { type: true } } },
    }),
    prisma.leadAssignment.groupBy({ by: ["leadId"], where: { active: true } }),
    prisma.visitRecord.count({ where: { visitedAt: { not: null } } }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const lead of leads) {
    statusCounts[lead.status] = (statusCounts[lead.status] ?? 0) + 1;
  }

  const averageLeadScore = leads.length ? Math.round(leads.reduce((s, l) => s + l.leadScore, 0) / leads.length) : 0;
  const highIntentCount = leads.filter((l) => l.leadScore >= 70).length;

  const opportunityTypeCounts: Record<string, number> = {};
  for (const lead of leads) {
    if (lead.opportunity) {
      opportunityTypeCounts[lead.opportunity.type] = (opportunityTypeCounts[lead.opportunity.type] ?? 0) + 1;
    }
  }

  const leadsByDay: Record<string, number> = {};
  for (const lead of leads) {
    const day = lead.createdAt.toISOString().slice(0, 10);
    leadsByDay[day] = (leadsByDay[day] ?? 0) + 1;
  }

  return {
    overview: {
      totalBusinesses,
      totalLeads,
      newLeads: statusCounts.NEW ?? 0,
      qualifiedLeads: totalLeads,
      assignedLeads: activeAssignedLeadCount.length,
      contactedLeads: leads.filter((l) => CONTACTED_OR_LATER.includes(l.status)).length,
      visitsCompleted: visitsCompletedCount,
      applicationsStarted: leads.filter((l) => APPLICATION_OR_LATER.includes(l.status)).length,
      approvals: leads.filter((l) => APPROVED_OR_LATER.includes(l.status)).length,
      disbursements: statusCounts.DISBURSED ?? 0,
    },
    funnel: {
      fundingOpportunitiesDetected: opportunitiesDetected,
      interested: interestedOrConverted,
      qualifiedLeads: totalLeads,
      assigned: activeAssignedLeadCount.length,
      contacted: leads.filter((l) => CONTACTED_OR_LATER.includes(l.status)).length,
      visited: leads.filter((l) => VISITED_OR_LATER.includes(l.status)).length,
      applications: leads.filter((l) => APPLICATION_OR_LATER.includes(l.status)).length,
      approvals: leads.filter((l) => APPROVED_OR_LATER.includes(l.status)).length,
      disbursements: statusCounts.DISBURSED ?? 0,
    },
    leadQuality: {
      averageLeadScore,
      highIntentCount,
      highIntentPercentage: leads.length ? Math.round((highIntentCount / leads.length) * 1000) / 10 : 0,
    },
    statusBreakdown: statusCounts,
    fundingTypeAttribution: opportunityTypeCounts,
    leadsByDay,
  };
}

export async function listAuditLog(page: number, limit: number) {
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { actor: { select: { phone: true, role: true } } },
    }),
    prisma.auditLog.count(),
  ]);
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) || 0 };
}
