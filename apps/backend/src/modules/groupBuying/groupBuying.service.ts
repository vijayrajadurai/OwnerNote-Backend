import type { GroupBuyingRequest, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../utils/errors";
import {
  computeGroupTotals,
  dateWindow,
  findDuplicateRequest,
  findNearbyMatches,
  roundDistanceKm,
} from "./groupBuying.logic";
import type {
  GroupBuyingMatchesResponse,
  GroupBuyingMatchPublic,
  MatchableGroupBuyingRequest,
} from "./groupBuying.types";

export type CreateGroupBuyingRequestInput = {
  productId: string;
  quantity: number;
  unit: string;
  requiredDate: string;
  latitude: number;
  longitude: number;
  areaLabel: string;
  radiusKm: number;
};

function toMatchable(row: GroupBuyingRequest): MatchableGroupBuyingRequest {
  return {
    id: row.id,
    businessId: row.businessId,
    productId: row.productId,
    quantity: row.quantity,
    unit: row.unit,
    requiredDate: row.requiredDate,
    latitude: row.latitude,
    longitude: row.longitude,
    areaLabel: row.areaLabel,
    radiusKm: row.radiusKm,
    status: row.status,
  };
}

function serializeOwnRequest(row: GroupBuyingRequest) {
  return {
    id: row.id,
    businessId: row.businessId,
    productId: row.productId,
    quantity: row.quantity,
    unit: row.unit,
    requiredDate: row.requiredDate,
    latitude: row.latitude,
    longitude: row.longitude,
    areaLabel: row.areaLabel,
    radiusKm: row.radiusKm,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPublicMatch(
  match: MatchableGroupBuyingRequest & { distanceKm: number },
): GroupBuyingMatchPublic {
  return {
    requestId: match.id,
    businessId: match.businessId,
    areaLabel: match.areaLabel,
    quantity: match.quantity,
    unit: match.unit,
    requiredDate: match.requiredDate,
    distanceKm: roundDistanceKm(match.distanceKm),
  };
}

export async function createRequest(businessId: string, input: CreateGroupBuyingRequestInput) {
  const existing = await prisma.groupBuyingRequest.findMany({
    where: { businessId, productId: input.productId, requiredDate: input.requiredDate },
  });
  const duplicate = findDuplicateRequest(existing.map(toMatchable), {
    businessId,
    productId: input.productId,
    requiredDate: input.requiredDate,
  });
  if (duplicate) {
    throw new ConflictError("An active group-buying request already exists for this product and date.");
  }

  const created = await prisma.groupBuyingRequest.create({
    data: { businessId, ...input },
  });
  return serializeOwnRequest(created);
}

export async function listRequests(businessId: string) {
  const rows = await prisma.groupBuyingRequest.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(serializeOwnRequest);
}

export async function listMatches(businessId: string, requestId: string): Promise<GroupBuyingMatchesResponse> {
  const originRow = await prisma.groupBuyingRequest.findFirst({
    where: { id: requestId, businessId },
  });
  if (!originRow) throw new NotFoundError("Group buying request not found");
  if (originRow.status === "CANCELLED" || originRow.status === "CLOSED") {
    throw new ValidationError("This request is no longer active.");
  }

  const origin = toMatchable(originRow);
  const windowDates = dateWindow(origin.requiredDate);

  const candidates = await prisma.groupBuyingRequest.findMany({
    where: {
      productId: origin.productId,
      status: "ACTIVE",
      requiredDate: { in: windowDates },
      businessId: { not: businessId },
    },
  });

  const matches = findNearbyMatches(origin, candidates.map(toMatchable));
  return {
    matches: matches.map(toPublicMatch),
    totals: computeGroupTotals(origin, matches),
  };
}

export async function joinGroup(businessId: string, requestId: string) {
  const originRow = await prisma.groupBuyingRequest.findFirst({
    where: { id: requestId, businessId },
  });
  if (!originRow) throw new NotFoundError("Group buying request not found");
  if (originRow.status === "CANCELLED" || originRow.status === "CLOSED") {
    throw new ValidationError("This request is no longer active.");
  }

  const origin = toMatchable(originRow);
  const windowDates = dateWindow(origin.requiredDate);
  const candidates = await prisma.groupBuyingRequest.findMany({
    where: {
      productId: origin.productId,
      status: "ACTIVE",
      requiredDate: { in: windowDates },
      businessId: { not: businessId },
    },
  });
  const matches = findNearbyMatches(origin, candidates.map(toMatchable));

  const result = await prisma.$transaction(async (tx) => {
    const group = await findOrCreateGroup(tx, origin);
    await upsertMember(tx, group.id, originRow, "JOINED");

    for (const match of matches) {
      const matchRow = candidates.find((row) => row.id === match.id);
      if (!matchRow) continue;
      await upsertMember(tx, group.id, matchRow, "PENDING");
      if (matchRow.status === "ACTIVE") {
        await tx.groupBuyingRequest.update({
          where: { id: matchRow.id },
          data: { status: "MATCHED" },
        });
      }
    }

    const joined = await tx.groupBuyingRequest.update({
      where: { id: originRow.id },
      data: { status: "JOINED" },
    });

    const members = await tx.groupBuyingMember.findMany({
      where: { groupId: group.id },
      orderBy: { joinedAt: "asc" },
    });

    return { group, members, request: joined };
  });

  return {
    group: {
      id: result.group.id,
      productId: result.group.productId,
      requiredDate: result.group.requiredDate,
      areaLabel: result.group.areaLabel,
      status: result.group.status,
    },
    members: result.members.map((member) => ({
      id: member.id,
      groupId: member.groupId,
      requestId: member.requestId,
      businessId: member.businessId,
      quantity: member.quantity,
      status: member.status,
      joinedAt: member.joinedAt.toISOString(),
    })),
    request: serializeOwnRequest(result.request),
    matches: matches.map(toPublicMatch),
    totals: computeGroupTotals(origin, matches),
  };
}

export async function cancelRequest(businessId: string, requestId: string) {
  const row = await prisma.groupBuyingRequest.findUnique({ where: { id: requestId } });
  if (!row) throw new NotFoundError("Group buying request not found");
  if (row.businessId !== businessId) {
    throw new ForbiddenError("You can only cancel your own group-buying request.");
  }
  if (row.status === "CANCELLED") {
    return serializeOwnRequest(row);
  }

  const updated = await prisma.groupBuyingRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED" },
  });
  return serializeOwnRequest(updated);
}

async function findOrCreateGroup(
  tx: Prisma.TransactionClient,
  origin: MatchableGroupBuyingRequest,
) {
  const existing = await tx.groupBuyingGroup.findFirst({
    where: {
      productId: origin.productId,
      requiredDate: origin.requiredDate,
      areaLabel: origin.areaLabel,
      status: "ACTIVE",
    },
  });
  if (existing) return existing;
  return tx.groupBuyingGroup.create({
    data: {
      productId: origin.productId,
      requiredDate: origin.requiredDate,
      areaLabel: origin.areaLabel,
    },
  });
}

async function upsertMember(
  tx: Prisma.TransactionClient,
  groupId: string,
  request: GroupBuyingRequest,
  status: "PENDING" | "JOINED",
) {
  const existing = await tx.groupBuyingMember.findFirst({
    where: { groupId, requestId: request.id },
  });
  if (existing) {
    return tx.groupBuyingMember.update({
      where: { id: existing.id },
      data: { status, quantity: request.quantity },
    });
  }
  return tx.groupBuyingMember.create({
    data: {
      groupId,
      requestId: request.id,
      businessId: request.businessId,
      quantity: request.quantity,
      status,
    },
  });
}
