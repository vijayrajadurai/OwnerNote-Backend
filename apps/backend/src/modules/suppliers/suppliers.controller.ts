import type { Request, Response } from "express";
import { z } from "zod";
import * as suppliersService from "./suppliers.service";
import * as businessService from "../business/business.service";
import { UnauthorizedError } from "../../utils/errors";

const createSupplierSchema = z.object({
  name: z.string().min(2).max(150),
  phone: z.string().min(8).max(20).optional(),
});

async function requireBusinessId(req: Request): Promise<string> {
  if (!req.auth) throw new UnauthorizedError();
  const business = await businessService.getBusinessForUser(req.auth.userId);
  return business.id;
}

export async function listSuppliers(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const suppliers = await suppliersService.listSuppliers(businessId);
  res.status(200).json({ data: suppliers });
}

export async function getSupplier(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const supplier = await suppliersService.getSupplierDetail(businessId, req.params.id);
  res.status(200).json({ data: supplier });
}

export async function createSupplier(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const input = createSupplierSchema.parse(req.body);
  const supplier = await suppliersService.createSupplier(businessId, input);
  res.status(201).json({ data: supplier });
}
