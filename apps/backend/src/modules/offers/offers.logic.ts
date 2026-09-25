/**
 * Faithful port of the Owner Note Local Offers pure logic.
 *
 * Original (mobile): apps/mobile/src/storage/localAi/offers.ts. Keep this
 * file in lockstep with that source — same rules, no LLM, no invented
 * numbers. Only the row type differs (Prisma-backed rows here instead of
 * SQLite rows there).
 *
 * Deliberately separate from DiscoverItem (the shop's own product/event
 * news feed) — this is the geo-radius, expiring, consumer-facing offer
 * model with its own distance-ranked discovery.
 */
import { haversineKm } from "../groupBuying/groupBuying.logic";

export const OFFER_CATEGORIES = [
  "FOOD",
  "GROCERY",
  "FASHION",
  "BEAUTY",
  "AUTOMOBILE",
  "ELECTRONICS",
  "PHARMACY",
  "HOME",
  "HARDWARE",
  "JEWELLERY",
  "CAFE",
  "BAKERY",
  "FITNESS",
  "EDUCATION",
  "PET",
  "SERVICES",
] as const;
export type OfferCategoryId = (typeof OFFER_CATEGORIES)[number];

export const OFFER_TYPES = ["TODAY_OFFER", "NEW_ARRIVAL", "SPECIAL", "FESTIVAL", "STOCK_CLEARANCE", "TODAYS_SPECIAL", "LIMITED_TIME"] as const;
export type OfferTypeId = (typeof OFFER_TYPES)[number];

export const DEFAULT_OFFER_TYPE: OfferTypeId = "TODAY_OFFER";

export interface TimeWindow {
  startHour: number;
  endHour: number;
}

export const OFFER_HOUR_OPTIONS: number[] = Array.from({ length: 19 }, (_, i) => i + 6); // 6..24

export function formatHour12(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  const period = normalized < 12 ? "AM" : "PM";
  const displayHour = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${displayHour} ${period}`;
}

export function formatTimeWindowLabel(window: TimeWindow | null, language: "ta" | "en" = "en"): string {
  if (!window) return language === "ta" ? "இன்று" : "Today";
  return `${formatHour12(window.startHour)} – ${formatHour12(window.endHour)}`;
}

// Offers must always have a real expiry. "Today only" (default ON)
// expires at the end of the picked window, or end of the local calendar
// day when no window was picked. Non-today-only offers use a fixed,
// named default duration instead of an open-ended field.
const NON_TODAY_ONLY_DURATION_DAYS = 7;

export function computeExpiresAt(now: Date, todayOnly: boolean, window: TimeWindow | null): Date {
  const expiry = new Date(now);
  if (!todayOnly) {
    expiry.setDate(expiry.getDate() + NON_TODAY_ONLY_DURATION_DAYS);
    expiry.setHours(23, 59, 59, 999);
    return expiry;
  }
  if (window) {
    expiry.setHours(0, 0, 0, 0);
    expiry.setHours(expiry.getHours() + window.endHour);
  } else {
    expiry.setHours(23, 59, 59, 999);
  }
  return expiry;
}

export type OfferStatus = "ACTIVE" | "ENDED";

export interface MatchableOffer {
  id: string;
  businessId: string;
  category: string;
  title: string;
  status: OfferStatus;
  expiresAt: Date;
  latitude: number;
  longitude: number;
  createdAt: Date;
}

/** The one place "is this offer still live" is decided. `status` alone is
 * never enough: an offer nobody explicitly ended still stops being
 * discoverable the instant its own expiresAt passes. Never mutates the
 * offer — purely a read-time check. */
export function isOfferExpired(offer: Pick<MatchableOffer, "status" | "expiresAt">, now: Date): boolean {
  if (offer.status === "ENDED") return true;
  return offer.expiresAt.getTime() <= now.getTime();
}

export const OFFER_RADII_KM = [1, 3, 5, 10] as const;
export const DEFAULT_OFFER_RADIUS_KM = 1;

export interface OfferWithDistance<T extends MatchableOffer> {
  offer: T;
  distanceKm: number;
}

const DISTANCE_TIE_BREAK_KM = 0.05;

/** Distance first, then freshness, among offers that are both un-expired
 * and within radius. `offers` should already be pre-filtered to ACTIVE at
 * the DB layer — this never invents a candidate that wasn't passed in. */
export function findNearbyOffers<T extends MatchableOffer>(
  consumerLatitude: number,
  consumerLongitude: number,
  offers: T[],
  now: Date,
  radiusKm: number,
  categoryFilter?: string | null,
): OfferWithDistance<T>[] {
  return offers
    .filter((o) => !isOfferExpired(o, now))
    .filter((o) => !categoryFilter || o.category === categoryFilter)
    .map((o) => ({ offer: o, distanceKm: haversineKm(consumerLatitude, consumerLongitude, o.latitude, o.longitude) }))
    .filter((o) => o.distanceKm <= radiusKm)
    .sort((a, b) => {
      const distanceDiff = a.distanceKm - b.distanceKm;
      if (Math.abs(distanceDiff) > DISTANCE_TIE_BREAK_KM) return distanceDiff;
      return b.offer.createdAt.getTime() - a.offer.createdAt.getTime();
    });
}

export function formatDistanceLabel(distanceKm: number): string {
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m`;
  return `${distanceKm.toFixed(1)} km`;
}

function normalizeOfferTitle(title: string): string {
  return title.trim().toLowerCase();
}

/** Same business, same title, same category, still ACTIVE (and not yet
 * expired) is treated as "you're posting this again," never silently
 * duplicated. A genuinely new offer is never blocked. */
export function findDuplicateOffer<T extends MatchableOffer>(businessId: string, title: string, category: string, existingOffers: T[], now: Date): T | null {
  const target = normalizeOfferTitle(title);
  return existingOffers.find((o) => o.businessId === businessId && o.category === category && normalizeOfferTitle(o.title) === target && !isOfferExpired(o, now)) ?? null;
}
