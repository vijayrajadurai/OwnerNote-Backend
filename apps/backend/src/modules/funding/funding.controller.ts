import type { Request, Response } from "express";
import { z } from "zod";
import * as businessService from "../business/business.service";
import * as fundingService from "./funding.service";
import { UnauthorizedError } from "../../utils/errors";

async function requireBusinessId(req: Request): Promise<string> {
  if (!req.auth) throw new UnauthorizedError();
  const business = await businessService.getBusinessForUser(req.auth.userId);
  return business.id;
}

export async function listOpportunities(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const opportunities = await fundingService.refreshOpportunities(businessId);
  res.status(200).json({ data: opportunities });
}

export async function getOpportunity(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const opportunity = await fundingService.getOpportunity(businessId, req.params.id);
  res.status(200).json({ data: opportunity });
}

export async function markInterested(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const opportunity = await fundingService.markInterested(businessId, req.params.id);
  res.status(200).json({ data: opportunity });
}

export async function markNotNow(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const opportunity = await fundingService.markNotNow(businessId, req.params.id);
  res.status(200).json({ data: opportunity });
}

const qualificationSchema = z.object({
  workingCapitalRequirement: z.number().positive().optional(),
  fundingRequirementMin: z.number().positive().optional(),
  fundingRequirementMax: z.number().positive().optional(),
  preferredCallbackTime: z.string().max(100).optional(),
  userIntent: z.enum(["EXPLORE_OPTIONS", "TALK_TO_SOMEONE"]),
});

export async function createLead(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const qualification = qualificationSchema.parse(req.body);
  const lead = await fundingService.createLeadFromOpportunity(businessId, req.params.id, qualification);
  res.status(201).json({ data: lead });
}

export async function listMyLeads(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const leads = await fundingService.listMyLeads(businessId);
  res.status(200).json({ data: leads });
}
