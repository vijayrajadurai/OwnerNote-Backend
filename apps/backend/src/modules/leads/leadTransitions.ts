import type { LeadStatus } from "@prisma/client";

/**
 * Valid next statuses for each current status. The backend is the only
 * place this is enforced — the web dashboard must not invent its own copy
 * of this graph and rely on it for correctness.
 */
export const LEAD_STATUS_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  NEW: ["QUALIFIED", "ASSIGNED", "NOT_INTERESTED", "REJECTED"],
  QUALIFIED: ["ASSIGNED", "NOT_INTERESTED", "REJECTED"],
  // VISIT_SCHEDULED is reachable directly from ASSIGNED too — scheduling
  // the visit is often the FO's first recorded contact in practice.
  ASSIGNED: ["CONTACTED", "VISIT_SCHEDULED", "FOLLOW_UP", "NOT_INTERESTED", "REJECTED"],
  CONTACTED: ["VISIT_SCHEDULED", "FOLLOW_UP", "NOT_INTERESTED", "REJECTED"],
  VISIT_SCHEDULED: ["VISITED", "FOLLOW_UP", "NOT_INTERESTED", "REJECTED"],
  VISITED: ["APPLICATION_STARTED", "FOLLOW_UP", "NOT_INTERESTED", "REJECTED"],
  APPLICATION_STARTED: ["APPROVED", "REJECTED", "FOLLOW_UP"],
  APPROVED: ["DISBURSED", "REJECTED"],
  DISBURSED: [],
  NOT_INTERESTED: ["FOLLOW_UP"],
  REJECTED: [],
  FOLLOW_UP: ["CONTACTED", "VISIT_SCHEDULED", "VISITED", "NOT_INTERESTED", "REJECTED"],
};

export function isValidLeadTransition(from: LeadStatus, to: LeadStatus): boolean {
  if (from === to) return false;
  return LEAD_STATUS_TRANSITIONS[from].includes(to);
}
