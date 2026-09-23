/**
 * Faithful port of the Owner Note Group Buying matching engine.
 *
 * Original (mobile, Phase 1): apps/mobile/src/storage/localAi/groupBuying.ts
 * Keep this file in lockstep with that source — same rules, no LLM, no
 * invented prices. Only the row type differs (Prisma / MatchableGroupBuyingRequest).
 */
import type { MatchableGroupBuyingRequest } from "./groupBuying.types";

const EARTH_RADIUS_KM = 6371;
const COMPATIBLE_DATE_WINDOW_DAYS = 1;
const DUPLICATE_BLOCKING_STATUSES = new Set(["ACTIVE", "MATCHED", "JOINED"]);

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function roundDistanceKm(km: number): number {
  return Math.round(km * 10) / 10;
}

export function shiftIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return utc.toISOString().slice(0, 10);
}

export function dateWindow(isoDate: string, days = COMPATIBLE_DATE_WINDOW_DAYS): string[] {
  const dates: string[] = [];
  for (let offset = -days; offset <= days; offset += 1) {
    dates.push(shiftIsoDate(isoDate, offset));
  }
  return dates;
}

export function isCompatibleRequiredDate(a: string, b: string): boolean {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const aUtc = Date.UTC(ay, am - 1, ad);
  const bUtc = Date.UTC(by, bm - 1, bd);
  const diffDays = Math.abs(aUtc - bUtc) / 86_400_000;
  return diffDays <= COMPATIBLE_DATE_WINDOW_DAYS;
}

export function findNearbyMatches(
  origin: MatchableGroupBuyingRequest,
  candidates: MatchableGroupBuyingRequest[],
): Array<MatchableGroupBuyingRequest & { distanceKm: number }> {
  return candidates
    .filter((candidate) => candidate.id !== origin.id)
    .filter((candidate) => candidate.businessId !== origin.businessId)
    .filter((candidate) => candidate.productId === origin.productId)
    .filter((candidate) => candidate.status === "ACTIVE")
    .filter((candidate) => isCompatibleRequiredDate(origin.requiredDate, candidate.requiredDate))
    .map((candidate) => {
      const distanceKm = haversineKm(
        origin.latitude,
        origin.longitude,
        candidate.latitude,
        candidate.longitude,
      );
      return { ...candidate, distanceKm };
    })
    .filter((candidate) => candidate.distanceKm <= origin.radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export function computeGroupTotals(
  origin: MatchableGroupBuyingRequest,
  matches: Array<Pick<MatchableGroupBuyingRequest, "quantity">>,
): { totalQuantity: number; businessCount: number; unit: string } {
  const matchQuantity = matches.reduce((sum, match) => sum + match.quantity, 0);
  return {
    totalQuantity: origin.quantity + matchQuantity,
    businessCount: matches.length + 1,
    unit: origin.unit,
  };
}

export function findDuplicateRequest(
  existing: MatchableGroupBuyingRequest[],
  input: Pick<MatchableGroupBuyingRequest, "businessId" | "productId" | "requiredDate">,
): MatchableGroupBuyingRequest | null {
  return (
    existing.find(
      (row) =>
        row.businessId === input.businessId &&
        row.productId === input.productId &&
        row.requiredDate === input.requiredDate &&
        DUPLICATE_BLOCKING_STATUSES.has(row.status),
    ) ?? null
  );
}
