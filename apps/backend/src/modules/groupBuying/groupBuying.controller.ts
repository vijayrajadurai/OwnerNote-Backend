import type { Request, Response } from "express";
import { z } from "zod";
import * as businessService from "../business/business.service";
import { UnauthorizedError, ValidationError } from "../../utils/errors";
import * as groupBuyingService from "./groupBuying.service";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

const createRequestSchema = z.object({
  productId: z.string().min(1).max(120),
  quantity: z.number().positive(),
  unit: z.string().min(1).max(40),
  requiredDate: z.string().regex(DATE_KEY, "requiredDate must be YYYY-MM-DD"),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  areaLabel: z.string().min(1).max(150),
  radiusKm: z.number().positive().max(200),
});

async function requireBusinessId(req: Request): Promise<string> {
  if (!req.auth) throw new UnauthorizedError();
  const business = await businessService.getBusinessForUser(req.auth.userId);
  return business.id;
}

function assertNotNullIsland(lat: number, lon: number): void {
  if (lat === 0 && lon === 0) {
    throw new ValidationError("A real shop location is required; (0,0) is not valid.");
  }
}

export async function createRequestHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const input = createRequestSchema.parse(req.body);
  assertNotNullIsland(input.latitude, input.longitude);
  const created = await groupBuyingService.createRequest(businessId, input);
  res.status(201).json({ data: created });
}

export async function listRequestsHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const rows = await groupBuyingService.listRequests(businessId);
  res.status(200).json({ data: rows });
}

export async function listMatchesHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const result = await groupBuyingService.listMatches(businessId, req.params.id);
  res.status(200).json({ data: result });
}

export async function joinHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const result = await groupBuyingService.joinGroup(businessId, req.params.id);
  res.status(200).json({ data: result });
}

export async function cancelHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const result = await groupBuyingService.cancelRequest(businessId, req.params.id);
  res.status(200).json({ data: result });
}
