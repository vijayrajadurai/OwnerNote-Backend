import type { GroupBuyingRequest, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../utils/errors";
import { logger } from "../../utils/logger";
import { sendPushToUser } from "../devices/push.service";
import {
  computeGroupTotals,
  dateWindow,
  findDuplicateRequest,
  findNearbyMatches,
  haversineKm,
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
  shop: { businessName: string; ownerName: string },
  interestStatus = "POSTED",
): GroupBuyingMatchPublic {
  return {
    requestId: match.id,
    businessId: match.businessId,
    shopName: shop.businessName,
    ownerName: shop.ownerName,
    areaLabel: match.areaLabel,
    quantity: match.quantity,
    unit: match.unit,
    requiredDate: match.requiredDate,
    distanceKm: roundDistanceKm(match.distanceKm),
    interestStatus,
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

  await prisma.business.update({
    where: { id: businessId },
    data: {
      latitude: input.latitude,
      longitude: input.longitude,
      areaLabel: input.areaLabel,
      locationSource: "GPS",
    },
  });

  const created = await prisma.groupBuyingRequest.create({
    data: { businessId, ...input },
  });
  await fanOutCategoryInvites(created);
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

  const nearby = findNearbyMatches(origin, candidates.map(toMatchable));
  const shops = await prisma.business.findMany({
    where: { id: { in: nearby.map((row) => row.businessId) } },
    select: { id: true, businessName: true, ownerName: true },
  });
  const shopById = new Map(shops.map((shop) => [shop.id, shop]));

  const invites = await prisma.groupBuyingInvite.findMany({
    where: { requestId },
    include: { business: { select: { id: true, businessName: true, ownerName: true, latitude: true, longitude: true } } },
  });

  const inviteMatches: GroupBuyingMatchPublic[] = invites.map((invite) => {
    const distanceKm =
      invite.business.latitude != null && invite.business.longitude != null
        ? haversineKm(origin.latitude, origin.longitude, invite.business.latitude, invite.business.longitude)
        : 0;
    const qty = invite.status === "INTERESTED" && invite.quantity != null ? invite.quantity : origin.quantity;
    return {
      requestId: origin.id,
      businessId: invite.businessId,
      shopName: invite.business.businessName,
      ownerName: invite.business.ownerName,
      areaLabel: origin.areaLabel,
      quantity: qty,
      unit: origin.unit,
      requiredDate: origin.requiredDate,
      distanceKm: roundDistanceKm(distanceKm),
      interestStatus: invite.status,
    };
  });

  const invitedIds = new Set(inviteMatches.map((row) => row.businessId));
  const postedMatches = nearby
    .filter((match) => !invitedIds.has(match.businessId))
    .map((match) => {
      const shop = shopById.get(match.businessId);
      return toPublicMatch(match, {
        businessName: shop?.businessName ?? "Nearby shop",
        ownerName: shop?.ownerName ?? "",
      });
    });

  const matches = [...inviteMatches, ...postedMatches].sort((a, b) => a.distanceKm - b.distanceKm);
  const interestedQty = inviteMatches
    .filter((row) => row.interestStatus === "INTERESTED")
    .reduce((sum, row) => sum + row.quantity, 0);
  const postedQty = postedMatches.reduce((sum, row) => sum + row.quantity, 0);
  const extraCount =
    inviteMatches.filter((row) => row.interestStatus === "INTERESTED").length + postedMatches.length;

  return {
    matches,
    totals: {
      totalQuantity: origin.quantity + interestedQty + postedQty,
      businessCount: extraCount + 1,
      unit: origin.unit,
    },
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
    ...(await listMatches(businessId, requestId)),
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

async function fanOutCategoryInvites(request: GroupBuyingRequest) {
  const origin = await prisma.business.findUnique({ where: { id: request.businessId } });
  if (!origin) return;

  const candidates = await prisma.business.findMany({
    where: {
      id: { not: request.businessId },
      category: origin.category,
      latitude: { not: null },
      longitude: { not: null },
    },
    select: {
      id: true,
      ownerUserId: true,
      businessName: true,
      latitude: true,
      longitude: true,
    },
  });

  const nearby = candidates.filter((shop) => {
    if (shop.latitude == null || shop.longitude == null) return false;
    return haversineKm(request.latitude, request.longitude, shop.latitude, shop.longitude) <= request.radiusKm;
  });

  for (const shop of nearby) {
    const invite = await prisma.groupBuyingInvite.upsert({
      where: { requestId_businessId: { requestId: request.id, businessId: shop.id } },
      create: { requestId: request.id, businessId: shop.id, status: "PENDING" },
      update: {},
    });
    if (invite.status !== "PENDING") continue;
    try {
      await sendPushToUser(shop.ownerUserId, {
        title: "Group buying nearby",
        body: `${origin.businessName} needs ${request.quantity} ${request.unit} of ${request.productId}. Interested?`,
        data: {
          type: "GROUP_BUYING_INVITE",
          requestId: request.id,
          inviteId: invite.id,
        },
      });
    } catch (error) {
      logger.warn({ err: error, shopId: shop.id }, "Could not send group-buying invite push");
    }
  }
}

export async function listInbox(businessId: string) {
  const rows = await prisma.groupBuyingInvite.findMany({
    where: {
      businessId,
      request: { status: { in: ["ACTIVE", "MATCHED"] } },
    },
    include: {
      request: {
        include: {
          business: { select: { businessName: true, ownerName: true, latitude: true, longitude: true } },
        },
      },
      business: { select: { latitude: true, longitude: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((row) => {
    const origin = row.request.business;
    const distanceKm =
      origin.latitude != null && origin.longitude != null && row.business.latitude != null && row.business.longitude != null
        ? haversineKm(origin.latitude, origin.longitude, row.business.latitude, row.business.longitude)
        : haversineKm(row.request.latitude, row.request.longitude, row.business.latitude ?? row.request.latitude, row.business.longitude ?? row.request.longitude);
    return {
      id: row.id,
      status: row.status,
      quantity: row.quantity,
      distanceKm: roundDistanceKm(distanceKm),
      request: {
        id: row.request.id,
        productId: row.request.productId,
        quantity: row.request.quantity,
        unit: row.request.unit,
        requiredDate: row.request.requiredDate,
        areaLabel: row.request.areaLabel,
        shopName: origin.businessName,
        ownerName: origin.ownerName,
      },
    };
  });
}

export type RespondInviteInput = {
  interested: boolean;
  quantity?: number;
};

export async function respondToInvite(businessId: string, inviteId: string, input: RespondInviteInput) {
  const invite = await prisma.groupBuyingInvite.findFirst({
    where: { id: inviteId, businessId },
    include: { request: true },
  });
  if (!invite) throw new NotFoundError("Group buying invite not found");
  if (invite.request.status === "CANCELLED" || invite.request.status === "CLOSED") {
    throw new ValidationError("This request is no longer active.");
  }
  if (input.interested) {
    if (input.quantity == null || input.quantity <= 0) {
      throw new ValidationError("Enter how many pieces or units you want.");
    }
  }

  const updated = await prisma.groupBuyingInvite.update({
    where: { id: invite.id },
    data: {
      status: input.interested ? "INTERESTED" : "NOT_INTERESTED",
      quantity: input.interested ? input.quantity : null,
    },
  });

  if (input.interested && invite.request.status === "ACTIVE") {
    await prisma.groupBuyingRequest.update({
      where: { id: invite.requestId },
      data: { status: "MATCHED" },
    });
  }

  const origin = await prisma.business.findUnique({
    where: { id: invite.request.businessId },
    select: { ownerUserId: true, businessName: true },
  });
  const responder = await prisma.business.findUnique({
    where: { id: businessId },
    select: { businessName: true, ownerName: true },
  });
  if (origin) {
    try {
      await sendPushToUser(origin.ownerUserId, {
        title: input.interested ? "Shop is interested" : "Shop declined",
        body: input.interested
          ? `${responder?.businessName ?? "A nearby shop"} wants ${updated.quantity} ${invite.request.unit} of ${invite.request.productId}`
          : `${responder?.businessName ?? "A nearby shop"} is not interested in ${invite.request.productId}`,
        data: {
          type: "GROUP_BUYING_RESPONSE",
          requestId: invite.requestId,
          inviteId: invite.id,
        },
      });
    } catch (error) {
      logger.warn({ err: error }, "Could not send group-buying response push");
    }
  }

  return {
    id: updated.id,
    status: updated.status,
    quantity: updated.quantity,
    requestId: updated.requestId,
    shopName: responder?.businessName ?? "",
    ownerName: responder?.ownerName ?? "",
  };
}
