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
  // The app's master-list codes the owner picked (several allowed). Not a fixed list here, so the app can add
  // categories without a backend change; `category` above stays the value older features read.
  categories: z
    .array(z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/))
    .max(80)
    .transform((codes) => Array.from(new Set(codes)))
    .optional(),
  otherCategoryName: z.string().trim().min(2).max(60).nullish(),
  // What the business does (several allowed); left out by an older app = kept as it is.
  businessTypes: z
    .array(z.enum(["SERVICE", "RETAIL", "WHOLESALE"]))
    .max(3)
    .transform((types) => Array.from(new Set(types)))
    .optional(),
  city: z.string().min(2).max(100),
  runningSinceYear: z.number().int().min(1950).max(new Date().getFullYear()).optional(),
  monthlyVolumeApprox: z.number().nonnegative().optional(),
  latitude: z.number().gte(-90).lte(90).nullish(),
  longitude: z.number().gte(-180).lte(180).nullish(),
  areaLabel: z.string().min(1).max(150).nullish(),
  locationSource: z.enum(["GPS", "MANUAL"]).nullish(),
});

function requireUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth.userId;
}

export async function getMyBusiness(req: Request, res: Response): Promise<void> {
  const business = await businessService.getBusinessForUser(requireUserId(req));
  res.status(200).json({ data: await businessService.withOwnerPhone(business) });
}

export async function putMyBusiness(req: Request, res: Response): Promise<void> {
  const input = businessSchema.parse(req.body);
  const business = await businessService.upsertBusinessForUser(requireUserId(req), input);
  res.status(200).json({ data: await businessService.withOwnerPhone(business) });
}
