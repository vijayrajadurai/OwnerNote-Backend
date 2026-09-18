import type { Request, Response } from "express";
import { z } from "zod";
import * as customersService from "./customers.service";
import * as businessService from "../business/business.service";
import { UnauthorizedError } from "../../utils/errors";

const createCustomerSchema = z.object({
  name: z.string().min(2).max(150),
  phone: z.string().min(8).max(20).optional(),
});

async function requireBusinessId(req: Request): Promise<string> {
  if (!req.auth) throw new UnauthorizedError();
  const business = await businessService.getBusinessForUser(req.auth.userId);
  return business.id;
}

export async function listCustomers(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const customers = await customersService.listCustomers(businessId);
  res.status(200).json({ data: customers });
}

export async function getCustomer(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const customer = await customersService.getCustomerDetail(businessId, req.params.id);
  res.status(200).json({ data: customer });
}

export async function createCustomer(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const input = createCustomerSchema.parse(req.body);
  const customer = await customersService.createCustomer(businessId, input);
  res.status(201).json({ data: customer });
}
