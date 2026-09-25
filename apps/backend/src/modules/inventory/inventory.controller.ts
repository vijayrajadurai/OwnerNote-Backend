import type { Request, Response } from "express";
import { z } from "zod";
import * as businessService from "../business/business.service";
import { UnauthorizedError } from "../../utils/errors";
import * as inventoryService from "./inventory.service";

async function requireBusinessId(req: Request): Promise<string> {
  if (!req.auth) throw new UnauthorizedError();
  const business = await businessService.getBusinessForUser(req.auth.userId);
  return business.id;
}

const createProductSchema = z.object({
  name: z.string().min(1).max(150),
  category: z.string().min(1).max(100),
  unit: z.string().min(1).max(40),
  currentStock: z.number().nonnegative().default(0),
  minimumStock: z.number().nonnegative().default(0),
});

const updateProductSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  category: z.string().min(1).max(100).optional(),
  unit: z.string().min(1).max(40).optional(),
  minimumStock: z.number().nonnegative().optional(),
});

const stockChangeSchema = z.object({
  quantity: z.number().positive(),
  reason: z.string().min(1).max(60),
  occurredAt: z.string().datetime().optional(),
});

export async function listProductsHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const rows = await inventoryService.listProducts(businessId);
  res.status(200).json({ data: rows });
}

export async function getLowStockHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const rows = await inventoryService.getLowStockProducts(businessId);
  res.status(200).json({ data: rows });
}

export async function getProductHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const row = await inventoryService.getProduct(businessId, req.params.id);
  res.status(200).json({ data: row });
}

export async function createProductHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const input = createProductSchema.parse(req.body);
  const result = await inventoryService.createProduct(businessId, input);
  res.status(result.outcome === "CREATED" ? 201 : 200).json({ data: result });
}

export async function updateProductHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const input = updateProductSchema.parse(req.body);
  const row = await inventoryService.updateProduct(businessId, req.params.id, input);
  res.status(200).json({ data: row });
}

export async function deleteProductHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  await inventoryService.deleteProduct(businessId, req.params.id);
  res.status(204).send();
}

export async function addStockHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const input = stockChangeSchema.parse(req.body);
  const product = await inventoryService.addStock(businessId, req.params.id, input.quantity, input.reason, input.occurredAt ? new Date(input.occurredAt) : undefined);
  res.status(200).json({ data: { outcome: "OK", product } });
}

export async function removeStockHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const input = stockChangeSchema.parse(req.body);
  const result = await inventoryService.removeStock(businessId, req.params.id, input.quantity, input.reason, input.occurredAt ? new Date(input.occurredAt) : undefined);
  res.status(200).json({ data: result });
}

export async function listMovementsHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const rows = await inventoryService.listMovements(businessId, req.params.id);
  res.status(200).json({ data: rows });
}

export async function getIntelligenceSummaryHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const summary = await inventoryService.getIntelligenceSummary(businessId);
  res.status(200).json({ data: summary });
}

export async function getProductIntelligenceHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const intelligence = await inventoryService.getProductIntelligence(businessId, req.params.id);
  res.status(200).json({ data: intelligence });
}
