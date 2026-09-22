import type { Request, Response } from "express";
import { z } from "zod";
import * as adminService from "./admin.service";

export async function listSalesOfficers(_req: Request, res: Response): Promise<void> {
  const officers = await adminService.listSalesOfficers();
  res.status(200).json({ data: officers });
}

const createSalesOfficerSchema = z.object({
  phone: z.string().min(8).max(20),
  name: z.string().min(2).max(100),
  territory: z.string().max(100).optional(),
});

export async function createSalesOfficer(req: Request, res: Response): Promise<void> {
  const input = createSalesOfficerSchema.parse(req.body);
  const officer = await adminService.createSalesOfficer(input);
  res.status(201).json({ data: officer });
}

export async function getSalesOfficerPerformance(req: Request, res: Response): Promise<void> {
  const performance = await adminService.getSalesOfficerPerformance(req.params.id);
  res.status(200).json({ data: performance });
}

export async function listAllSalesOfficerPerformance(_req: Request, res: Response): Promise<void> {
  const performance = await adminService.getAllSalesOfficerPerformance();
  res.status(200).json({ data: performance });
}

export async function getPipelineAnalytics(_req: Request, res: Response): Promise<void> {
  const analytics = await adminService.getPipelineAnalytics();
  res.status(200).json({ data: analytics });
}

const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export { adminSendPush as sendPush } from "../devices/devices.controller";

export async function listAuditLog(req: Request, res: Response): Promise<void> {
  const { page, limit } = auditLogQuerySchema.parse(req.query);
  const result = await adminService.listAuditLog(page ?? 1, Math.min(limit ?? 25, 100));
  res.status(200).json({ data: result.items, page: result.page, limit: result.limit, total: result.total, totalPages: result.totalPages });
}
