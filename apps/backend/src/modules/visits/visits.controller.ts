import type { Request, Response } from "express";
import { z } from "zod";
import * as visitsService from "./visits.service";
import { UnauthorizedError } from "../../utils/errors";

const VISIT_OUTCOMES = [
  "SCHEDULED",
  "VISITED",
  "CUSTOMER_INTERESTED",
  "CUSTOMER_NOT_INTERESTED",
  "FOLLOW_UP_REQUIRED",
  "APPLICATION_STARTED",
  "NOT_CONTACTABLE",
  "CANCELLED",
] as const;

const visitInputSchema = z.object({
  scheduledAt: z.string().datetime().optional(),
  visitedAt: z.string().datetime().optional(),
  outcome: z.enum(VISIT_OUTCOMES).optional(),
  notes: z.string().max(1000).optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
});

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function createVisit(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const input = visitInputSchema.parse(req.body);
  const visit = await visitsService.createVisit(auth, req.params.leadId, input);
  res.status(201).json({ data: visit });
}

export async function updateVisit(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const input = visitInputSchema.parse(req.body);
  const visit = await visitsService.updateVisit(auth, req.params.id, input);
  res.status(200).json({ data: visit });
}

export async function listVisitsForLead(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const visits = await visitsService.listVisitsForLead(auth, req.params.leadId);
  res.status(200).json({ data: visits });
}

export async function getVisit(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const visit = await visitsService.getVisit(auth, req.params.id);
  res.status(200).json({ data: visit });
}

export async function listUpcomingFollowUps(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const followUps = await visitsService.listUpcomingFollowUps(auth);
  res.status(200).json({ data: followUps });
}
