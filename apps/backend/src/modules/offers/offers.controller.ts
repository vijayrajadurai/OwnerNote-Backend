import type { Request, Response } from "express";
import { z } from "zod";
import * as businessService from "../business/business.service";
import { UnauthorizedError } from "../../utils/errors";
import * as offersService from "./offers.service";
import { OFFER_CATEGORIES, OFFER_RADII_KM } from "./offers.logic";

async function requireBusinessId(req: Request): Promise<string> {
  if (!req.auth) throw new UnauthorizedError();
  const business = await businessService.getBusinessForUser(req.auth.userId);
  return business.id;
}

const timeWindowSchema = z.object({ startHour: z.number().int().min(0).max(24), endHour: z.number().int().min(0).max(24) });

const createOfferSchema = z.object({
  category: z.enum(OFFER_CATEGORIES),
  offerType: z.string().min(1).max(60),
  title: z.string().min(2).max(150),
  description: z.string().max(500).nullish(),
  price: z.number().positive(),
  imageUri: z.string().max(500).nullish(),
  todayOnly: z.boolean().default(true),
  timeWindow: timeWindowSchema.nullish(),
});

const updateOfferSchema = createOfferSchema.partial();

const nearbyQuerySchema = z.object({
  latitude: z.coerce.number().gte(-90).lte(90),
  longitude: z.coerce.number().gte(-180).lte(180),
  radiusKm: z.coerce.number().positive().max(200).default(OFFER_RADII_KM[0]),
  category: z.enum(OFFER_CATEGORIES).optional(),
});

export async function listMyOffersHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const rows = await offersService.listMyOffers(businessId);
  res.status(200).json({ data: rows });
}

export async function createOfferHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const input = createOfferSchema.parse(req.body);
  const result = await offersService.createOffer(businessId, {
    ...input,
    description: input.description ?? null,
    imageUri: input.imageUri ?? null,
    timeWindow: input.timeWindow ?? null,
  });
  res.status(result.outcome === "CREATED" ? 201 : 200).json({ data: result });
}

export async function updateOfferHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const input = updateOfferSchema.parse(req.body);
  const row = await offersService.updateOffer(businessId, req.params.id, {
    ...input,
    description: input.description === undefined ? undefined : input.description,
    imageUri: input.imageUri === undefined ? undefined : input.imageUri,
    timeWindow: input.timeWindow === undefined ? undefined : (input.timeWindow ?? null),
  });
  res.status(200).json({ data: row });
}

export async function endOfferHandler(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const row = await offersService.endOffer(businessId, req.params.id);
  res.status(200).json({ data: row });
}

export async function getNearbyOffersHandler(req: Request, res: Response): Promise<void> {
  const input = nearbyQuerySchema.parse(req.query);
  const rows = await offersService.getNearbyOffers(input);
  res.status(200).json({ data: rows });
}

export async function getOfferHandler(req: Request, res: Response): Promise<void> {
  const offer = await offersService.getOfferById(req.params.id);
  if (!offer) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Offer not found" } });
    return;
  }
  res.status(200).json({ data: offer });
}

export async function recordViewHandler(req: Request, res: Response): Promise<void> {
  await offersService.recordOfferView(req.params.id);
  res.status(204).send();
}

export async function recordDirectionsHandler(req: Request, res: Response): Promise<void> {
  await offersService.recordOfferDirectionsTap(req.params.id);
  res.status(204).send();
}

export async function recordCallHandler(req: Request, res: Response): Promise<void> {
  await offersService.recordOfferCallTap(req.params.id);
  res.status(204).send();
}
