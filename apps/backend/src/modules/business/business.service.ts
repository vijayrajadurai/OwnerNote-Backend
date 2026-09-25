import { prisma } from "../../db/prisma";
import { NotFoundError } from "../../utils/errors";
import type { Business, BusinessCategory } from "@prisma/client";

export interface BusinessInput {
  ownerName: string;
  businessName: string;
  category: BusinessCategory;
  city: string;
  runningSinceYear?: number;
  monthlyVolumeApprox?: number;
  latitude?: number | null;
  longitude?: number | null;
  areaLabel?: string | null;
  locationSource?: "GPS" | "MANUAL" | null;
}

export async function getBusinessForUser(userId: string): Promise<Business> {
  const business = await prisma.business.findUnique({ where: { ownerUserId: userId } });
  if (!business) {
    throw new NotFoundError("Business profile not set up yet");
  }
  return business;
}

export async function upsertBusinessForUser(userId: string, input: BusinessInput): Promise<Business> {
  return prisma.business.upsert({
    where: { ownerUserId: userId },
    create: { ownerUserId: userId, ...input },
    update: { ...input },
  });
}

export async function withOwnerPhone<T extends Business>(business: T): Promise<T & { phone: string | null }> {
  const owner = await prisma.user.findUnique({
    where: { id: business.ownerUserId },
    select: { phone: true },
  });
  return { ...business, phone: owner?.phone ?? null };
}
