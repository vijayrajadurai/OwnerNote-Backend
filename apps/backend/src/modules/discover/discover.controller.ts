import type { Request, Response } from "express";
import { z } from "zod";
import * as businessService from "../business/business.service";
import * as discoverService from "./discover.service";
import { UnauthorizedError } from "../../utils/errors";

const discoverTypeSchema = z.enum(["PRODUCT", "OFFER", "EVENT", "CELEBRATION"]);

const createDiscoverSchema = z.object({
  type: discoverTypeSchema,
  title: z.string().min(2).max(200),
  summary: z.string().min(2).max(500),
  detail: z.string().max(1000).optional(),
  priceLabel: z.string().max(100).optional(),
  validUntil: z.string().datetime().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

const updateDiscoverSchema = createDiscoverSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const adminListQuerySchema = z.object({
  businessId: z.string().uuid(),
});

const adminCreateSchema = createDiscoverSchema.extend({
  businessId: z.string().uuid(),
});

async function requireBusinessId(req: Request): Promise<string> {
  if (!req.auth) throw new UnauthorizedError();
  const business = await businessService.getBusinessForUser(req.auth.userId);
  return business.id;
}

export async function getDiscoverFeed(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const items = await discoverService.listDiscoverFeed(businessId);
  res.status(200).json({ data: items });
}

export async function createDiscoverItem(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const input = createDiscoverSchema.parse(req.body);
  const item = await discoverService.createDiscoverItem(businessId, input);
  res.status(201).json({ data: item });
}

export async function updateDiscoverItem(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const input = updateDiscoverSchema.parse(req.body);
  const item = await discoverService.updateDiscoverItem(businessId, req.params.id, input);
  res.status(200).json({ data: item });
}

export async function deleteDiscoverItem(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const item = await discoverService.deleteDiscoverItem(businessId, req.params.id);
  res.status(200).json({ data: item });
}

export async function adminListDiscover(req: Request, res: Response): Promise<void> {
  const { businessId } = adminListQuerySchema.parse(req.query);
  const items = await discoverService.listDiscoverFeed(businessId, true);
  res.status(200).json({ data: items });
}

export async function adminCreateDiscover(req: Request, res: Response): Promise<void> {
  const { businessId, ...input } = adminCreateSchema.parse(req.body);
  const item = await discoverService.createDiscoverItem(businessId, input);
  res.status(201).json({ data: item });
}

export async function adminUpdateDiscover(req: Request, res: Response): Promise<void> {
  const input = updateDiscoverSchema.parse(req.body);
  const businessId = z.string().uuid().parse(req.query.businessId);
  const item = await discoverService.updateDiscoverItem(businessId, req.params.id, input);
  res.status(200).json({ data: item });
}

export async function adminDeleteDiscover(req: Request, res: Response): Promise<void> {
  const businessId = z.string().uuid().parse(req.query.businessId);
  const item = await discoverService.deleteDiscoverItem(businessId, req.params.id);
  res.status(200).json({ data: item });
}

export async function adminListBusinesses(_req: Request, res: Response): Promise<void> {
  const businesses = await discoverService.listBusinessesBrief();
  res.status(200).json({ data: businesses });
}
