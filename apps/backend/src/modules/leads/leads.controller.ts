import type { Request, Response } from "express";
import { z } from "zod";
import * as leadsService from "./leads.service";
import { UnauthorizedError } from "../../utils/errors";

const BUSINESS_CATEGORIES = [
  "TEXTILE",
  "GROCERY",
  "HARDWARE",
  "ELECTRICAL",
  "MOBILE_ACCESSORIES",
  "AUTO_PARTS",
  "FURNITURE",
  "FOOTWEAR",
  "PHARMACY",
  "STATIONERY",
  "RESTAURANT_FOOD",
  "BEAUTY_SALON",
  "OTHER",
] as const;

const LEAD_STATUSES = [
  "NEW",
  "QUALIFIED",
  "ASSIGNED",
  "CONTACTED",
  "VISIT_SCHEDULED",
  "VISITED",
  "APPLICATION_STARTED",
  "APPROVED",
  "DISBURSED",
  "NOT_INTERESTED",
  "REJECTED",
  "FOLLOW_UP",
] as const;

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  search: z.string().min(1).max(150).optional(),
  category: z.enum(BUSINESS_CATEGORIES).optional(),
  city: z.string().min(1).max(100).optional(),
  assignedSalesOfficerId: z.string().uuid().optional(),
  unassignedOnly: z.coerce.boolean().optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  maxScore: z.coerce.number().min(0).max(100).optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  sortBy: z.enum(["leadScore", "createdAt", "city", "status"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

function requireAuth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export async function listLeads(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const params = listQuerySchema.parse(req.query);
  const result = await leadsService.listLeads(auth, params);
  res.status(200).json({ data: result.items, page: result.page, limit: result.limit, total: result.total, totalPages: result.totalPages });
}

export async function getWorkQueue(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const items = await leadsService.getWorkQueue(auth);
  res.status(200).json({ data: items });
}

export async function getFoSummary(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const summary = await leadsService.getFoSummary(auth);
  res.status(200).json({ data: summary });
}

export async function getLead(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const lead = await leadsService.getLeadDetail(auth, req.params.id);
  res.status(200).json({ data: lead });
}

const statusUpdateSchema = z.object({ status: z.enum(LEAD_STATUSES) });

export async function updateLeadStatus(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  const { status } = statusUpdateSchema.parse(req.body);
  const lead = await leadsService.updateLeadStatus(auth, req.params.id, status);
  res.status(200).json({ data: lead });
}
