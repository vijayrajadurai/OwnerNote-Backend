import type { DiscoverItem, DiscoverItemType } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { NotFoundError } from "../../utils/errors";
import { buildDiscoverSeedTemplates, seedTemplateToCreateData } from "./discoverSeed";

const MIN_ITEMS = 10;

export interface DiscoverFeedItem {
  id: string;
  type: string;
  title: string;
  summary: string;
  detail?: string;
  priceLabel?: string;
  validUntil?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

export interface DiscoverItemInput {
  type: DiscoverItemType;
  title: string;
  summary: string;
  detail?: string;
  priceLabel?: string;
  validUntil?: string;
  sortOrder?: number;
  isActive?: boolean;
}

function toFeedItem(item: DiscoverItem): DiscoverFeedItem {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    summary: item.summary,
    detail: item.detail ?? undefined,
    priceLabel: item.priceLabel ?? undefined,
    validUntil: item.validUntil?.toISOString(),
    sortOrder: item.sortOrder,
    isActive: item.isActive,
    createdAt: item.createdAt.toISOString(),
  };
}

async function ensureDiscoverSeed(businessId: string): Promise<void> {
  const count = await prisma.discoverItem.count({ where: { businessId, isActive: true } });
  if (count >= MIN_ITEMS) return;

  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) return;

  const templates = buildDiscoverSeedTemplates(business);
  await prisma.discoverItem.createMany({
    data: templates.map((template) => seedTemplateToCreateData(businessId, template)),
  });
}

export async function listDiscoverFeed(businessId: string, includeInactive = false): Promise<DiscoverFeedItem[]> {
  await ensureDiscoverSeed(businessId);

  const items = await prisma.discoverItem.findMany({
    where: { businessId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });

  return items.map(toFeedItem);
}

export async function createDiscoverItem(businessId: string, input: DiscoverItemInput): Promise<DiscoverFeedItem> {
  const item = await prisma.discoverItem.create({
    data: {
      businessId,
      type: input.type,
      title: input.title,
      summary: input.summary,
      detail: input.detail ?? null,
      priceLabel: input.priceLabel ?? null,
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    },
  });
  return toFeedItem(item);
}

export async function updateDiscoverItem(
  businessId: string,
  id: string,
  input: Partial<DiscoverItemInput>,
): Promise<DiscoverFeedItem> {
  const existing = await prisma.discoverItem.findFirst({ where: { id, businessId } });
  if (!existing) throw new NotFoundError("Discover item not found");

  const item = await prisma.discoverItem.update({
    where: { id },
    data: {
      ...(input.type != null ? { type: input.type } : {}),
      ...(input.title != null ? { title: input.title } : {}),
      ...(input.summary != null ? { summary: input.summary } : {}),
      ...(input.detail !== undefined ? { detail: input.detail ?? null } : {}),
      ...(input.priceLabel !== undefined ? { priceLabel: input.priceLabel ?? null } : {}),
      ...(input.validUntil !== undefined
        ? { validUntil: input.validUntil ? new Date(input.validUntil) : null }
        : {}),
      ...(input.sortOrder != null ? { sortOrder: input.sortOrder } : {}),
      ...(input.isActive != null ? { isActive: input.isActive } : {}),
    },
  });
  return toFeedItem(item);
}

export async function deleteDiscoverItem(businessId: string, id: string): Promise<DiscoverFeedItem> {
  const existing = await prisma.discoverItem.findFirst({ where: { id, businessId } });
  if (!existing) throw new NotFoundError("Discover item not found");

  const item = await prisma.discoverItem.update({
    where: { id },
    data: { isActive: false },
  });
  return toFeedItem(item);
}

export interface BusinessBrief {
  id: string;
  businessName: string;
  city: string;
  category: string;
}

export async function listBusinessesBrief(): Promise<BusinessBrief[]> {
  const businesses = await prisma.business.findMany({
    select: { id: true, businessName: true, city: true, category: true },
    orderBy: { businessName: "asc" },
  });
  return businesses;
}
