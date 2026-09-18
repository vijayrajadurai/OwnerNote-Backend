import type { Request, Response } from "express";
import { z } from "zod";
import * as businessService from "./business.service";
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

const businessSchema = z.object({
  ownerName: z.string().min(2).max(100),
  businessName: z.string().min(2).max(150),
  category: z.enum(BUSINESS_CATEGORIES),
  city: z.string().min(2).max(100),
  runningSinceYear: z.number().int().min(1950).max(new Date().getFullYear()).optional(),
  monthlyVolumeApprox: z.number().nonnegative().optional(),
});

function requireUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth.userId;
}

export async function getMyBusiness(req: Request, res: Response): Promise<void> {
  const business = await businessService.getBusinessForUser(requireUserId(req));
  res.status(200).json({ data: business });
}

export async function putMyBusiness(req: Request, res: Response): Promise<void> {
  const input = businessSchema.parse(req.body);
  const business = await businessService.upsertBusinessForUser(requireUserId(req), input);
  res.status(200).json({ data: business });
}
