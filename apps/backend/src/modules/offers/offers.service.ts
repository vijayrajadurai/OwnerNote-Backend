import type { LocalOffer } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { toNumber } from "../../utils/decimal";
import { NotFoundError, ValidationError } from "../../utils/errors";
import { computeExpiresAt, findDuplicateOffer, findNearbyOffers, formatTimeWindowLabel, type MatchableOffer, type TimeWindow } from "./offers.logic";
import type { LocalOfferDto, OfferWithDistanceDto } from "./offers.types";

function serialize(row: LocalOffer): LocalOfferDto {
  return {
    id: row.id,
    businessId: row.businessId,
    businessName: "",
    category: row.category,
    offerType: row.offerType,
    title: row.title,
    description: row.description,
    price: toNumber(row.price),
    imageUri: row.imageUri,
    todayOnly: row.todayOnly,
    timeWindowLabel: row.timeWindowLabel,
    startAt: row.startAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    latitude: row.latitude,
    longitude: row.longitude,
    areaLabel: row.areaLabel,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    viewCount: row.viewCount,
    directionsCount: row.directionsCount,
    callCount: row.callCount,
  };
}

function toMatchable(row: LocalOffer): MatchableOffer {
  return {
    id: row.id,
    businessId: row.businessId,
    category: row.category,
    title: row.title,
    status: row.status,
    expiresAt: row.expiresAt,
    latitude: row.latitude,
    longitude: row.longitude,
    createdAt: row.createdAt,
  };
}

export async function listMyOffers(businessId: string): Promise<LocalOfferDto[]> {
  const rows = await prisma.localOffer.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } });
  return rows.map(serialize);
}

export interface CreateOfferInput {
  category: string;
  offerType: string;
  title: string;
  description: string | null;
  price: number;
  imageUri: string | null;
  todayOnly: boolean;
  timeWindow: TimeWindow | null;
}

export type CreateOfferResult = { outcome: "DUPLICATE"; existing: LocalOfferDto } | { outcome: "CREATED"; offer: LocalOfferDto };

// Location comes from the business's own saved profile, never asked here —
// throws a clear, catchable error if it isn't set yet. Duplicate
// prevention happens before any row is written.
export async function createOffer(businessId: string, input: CreateOfferInput): Promise<CreateOfferResult> {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw new NotFoundError("Business profile not set up yet");
  if (business.latitude == null || business.longitude == null || !business.areaLabel) {
    throw new ValidationError("A real shop location is required before posting an offer.");
  }

  const now = new Date();
  const existing = await prisma.localOffer.findMany({ where: { businessId } });
  const duplicate = findDuplicateOffer(businessId, input.title, input.category, existing.map(toMatchable), now);
  if (duplicate) {
    const existingRow = existing.find((o) => o.id === duplicate.id)!;
    return { outcome: "DUPLICATE", existing: serialize(existingRow) };
  }

  const expiresAt = computeExpiresAt(now, input.todayOnly, input.timeWindow);
  const timeWindowLabel = formatTimeWindowLabel(input.todayOnly ? input.timeWindow : null);

  const created = await prisma.localOffer.create({
    data: {
      businessId,
      category: input.category,
      offerType: input.offerType,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      price: input.price,
      imageUri: input.imageUri,
      todayOnly: input.todayOnly,
      timeWindowLabel,
      startAt: now,
      expiresAt,
      latitude: business.latitude,
      longitude: business.longitude,
      areaLabel: business.areaLabel,
    },
  });

  return { outcome: "CREATED", offer: serialize(created) };
}

export interface UpdateOfferInput {
  category?: string;
  offerType?: string;
  title?: string;
  description?: string | null;
  price?: number;
  imageUri?: string | null;
  todayOnly?: boolean;
  timeWindow?: TimeWindow | null;
}

async function requireOwnOffer(businessId: string, id: string): Promise<LocalOffer> {
  const row = await prisma.localOffer.findFirst({ where: { id, businessId } });
  if (!row) throw new NotFoundError("Offer not found");
  return row;
}

// Never touches location/business fields; a fresh expiresAt is only
// recomputed when the owner actually changed the timing fields.
export async function updateOffer(businessId: string, id: string, input: UpdateOfferInput): Promise<LocalOfferDto> {
  const existing = await requireOwnOffer(businessId, id);

  const todayOnly = input.todayOnly ?? existing.todayOnly;
  const timeWindowChanged = input.timeWindow !== undefined || input.todayOnly !== undefined;
  const now = new Date();
  const expiresAt = timeWindowChanged ? computeExpiresAt(now, todayOnly, input.timeWindow ?? null) : existing.expiresAt;
  const timeWindowLabel = timeWindowChanged ? formatTimeWindowLabel(todayOnly ? (input.timeWindow ?? null) : null) : existing.timeWindowLabel;

  const updated = await prisma.localOffer.update({
    where: { id },
    data: {
      category: input.category ?? existing.category,
      offerType: input.offerType ?? existing.offerType,
      title: input.title !== undefined ? input.title.trim() : existing.title,
      description: input.description !== undefined ? input.description?.trim() || null : existing.description,
      price: input.price ?? existing.price,
      imageUri: input.imageUri !== undefined ? input.imageUri : existing.imageUri,
      todayOnly,
      timeWindowLabel,
      expiresAt,
    },
  });
  return serialize(updated);
}

// An explicit owner action, distinct from natural expiry.
export async function endOffer(businessId: string, id: string): Promise<LocalOfferDto> {
  await requireOwnOffer(businessId, id);
  const updated = await prisma.localOffer.update({ where: { id }, data: { status: "ENDED" } });
  return serialize(updated);
}

export interface NearbyOffersInput {
  latitude: number;
  longitude: number;
  radiusKm: number;
  category?: string | null;
}

// The consumer discovery feed — pre-filters to ACTIVE at the DB layer,
// then the pure findNearbyOffers does the expiry/radius/ranking work.
export async function getNearbyOffers(input: NearbyOffersInput): Promise<OfferWithDistanceDto[]> {
  const active = await prisma.localOffer.findMany({
    where: { status: "ACTIVE" },
    include: { business: { select: { businessName: true } } },
  });
  const byId = new Map(active.map((row) => [row.id, row]));
  const ranked = findNearbyOffers(input.latitude, input.longitude, active.map(toMatchable), new Date(), input.radiusKm, input.category ?? null);
  return ranked.map((r) => {
    const row = byId.get(r.offer.id)!;
    return { ...serialize(row), businessName: row.business.businessName, distanceKm: Math.round(r.distanceKm * 10) / 10 };
  });
}

async function incrementCounter(id: string, column: "viewCount" | "directionsCount" | "callCount"): Promise<void> {
  await prisma.localOffer.update({ where: { id }, data: { [column]: { increment: 1 } } });
}

// Real counters only, never estimated/fabricated numbers.
export const recordOfferView = (id: string) => incrementCounter(id, "viewCount");
export const recordOfferDirectionsTap = (id: string) => incrementCounter(id, "directionsCount");
export const recordOfferCallTap = (id: string) => incrementCounter(id, "callCount");

export async function getOfferById(id: string): Promise<LocalOfferDto | null> {
  const row = await prisma.localOffer.findUnique({ where: { id }, include: { business: { select: { businessName: true } } } });
  if (!row) return null;
  return { ...serialize(row), businessName: row.business.businessName };
}
