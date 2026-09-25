import { describe, expect, it } from "vitest";
import {
  computeExpiresAt,
  findDuplicateOffer,
  findNearbyOffers,
  formatDistanceLabel,
  formatTimeWindowLabel,
  isOfferExpired,
  type MatchableOffer,
} from "../src/modules/offers/offers.logic";

const NOW = new Date(2026, 8, 25, 14, 0, 0); // 25 Sep 2026, 2 PM local
const AMBATTUR = { lat: 13.1143, lon: 80.1548 };

function offer(overrides: Partial<MatchableOffer> = {}): MatchableOffer {
  return {
    id: "o1",
    businessId: "biz-1",
    category: "FOOD",
    title: "Chicken Biryani",
    status: "ACTIVE",
    expiresAt: new Date(2026, 8, 25, 23, 59, 59),
    latitude: AMBATTUR.lat,
    longitude: AMBATTUR.lon,
    createdAt: NOW,
    ...overrides,
  };
}

describe("computeExpiresAt", () => {
  it("todayOnly with a time window expires at the window's end hour", () => {
    const expiry = computeExpiresAt(NOW, true, { startHour: 12, endHour: 15 });
    expect(expiry.getHours()).toBe(15);
    expect(expiry.getDate()).toBe(NOW.getDate());
  });

  it("todayOnly with no window expires at end of the local calendar day", () => {
    const expiry = computeExpiresAt(NOW, true, null);
    expect(expiry.getHours()).toBe(23);
    expect(expiry.getMinutes()).toBe(59);
  });

  it("non-todayOnly uses a real fixed default duration, never open-ended", () => {
    const expiry = computeExpiresAt(NOW, false, null);
    expect(expiry.getTime()).toBeGreaterThan(NOW.getTime());
    expect(expiry.getDate()).not.toBe(NOW.getDate());
  });
});

describe("formatTimeWindowLabel", () => {
  it("formats a real window, or 'Today'/'இன்று' when none was picked", () => {
    expect(formatTimeWindowLabel({ startHour: 12, endHour: 15 }, "en")).toBe("12 PM – 3 PM");
    expect(formatTimeWindowLabel(null, "en")).toBe("Today");
    expect(formatTimeWindowLabel(null, "ta")).toBe("இன்று");
  });
});

describe("isOfferExpired", () => {
  it("is true once explicitly ENDED, regardless of expiresAt", () => {
    expect(isOfferExpired(offer({ status: "ENDED", expiresAt: new Date(2027, 0, 1) }), NOW)).toBe(true);
  });

  it("is true the instant expiresAt passes, even if status is still ACTIVE", () => {
    expect(isOfferExpired(offer({ status: "ACTIVE", expiresAt: new Date(2026, 8, 1) }), NOW)).toBe(true);
  });

  it("is false for a still-ACTIVE offer within its window", () => {
    expect(isOfferExpired(offer({ status: "ACTIVE", expiresAt: new Date(2027, 0, 1) }), NOW)).toBe(false);
  });
});

describe("findNearbyOffers — distance-first, freshness-tiebreak ranking", () => {
  it("sorts nearest first", () => {
    const near = offer({ id: "near", latitude: AMBATTUR.lat, longitude: AMBATTUR.lon });
    const far = offer({ id: "far", latitude: AMBATTUR.lat + 0.2, longitude: AMBATTUR.lon + 0.2 });
    const results = findNearbyOffers(AMBATTUR.lat, AMBATTUR.lon, [far, near], NOW, 50);
    expect(results[0].offer.id).toBe("near");
  });

  it("excludes expired/ended offers", () => {
    const expired = offer({ id: "expired", status: "ENDED" });
    const results = findNearbyOffers(AMBATTUR.lat, AMBATTUR.lon, [expired], NOW, 50);
    expect(results).toHaveLength(0);
  });

  it("excludes offers outside the given radius", () => {
    const coimbatore = offer({ id: "far", latitude: 11.0168, longitude: 76.9558 });
    const results = findNearbyOffers(AMBATTUR.lat, AMBATTUR.lon, [coimbatore], NOW, 10);
    expect(results).toHaveLength(0);
  });

  it("filters by category when given", () => {
    const food = offer({ id: "food", category: "FOOD" });
    const grocery = offer({ id: "grocery", category: "GROCERY" });
    const results = findNearbyOffers(AMBATTUR.lat, AMBATTUR.lon, [food, grocery], NOW, 50, "GROCERY");
    expect(results.map((r) => r.offer.id)).toEqual(["grocery"]);
  });
});

describe("findDuplicateOffer — duplicate-post protection", () => {
  it("flags the same business posting the same still-ACTIVE title+category again", () => {
    const existing = offer({ id: "existing", businessId: "biz-1", category: "FOOD", title: "Chicken Biryani" });
    const found = findDuplicateOffer("biz-1", "Chicken Biryani", "FOOD", [existing], NOW);
    expect(found?.id).toBe("existing");
  });

  it("never flags a genuinely different title or category", () => {
    const existing = offer({ id: "existing", businessId: "biz-1", category: "FOOD", title: "Chicken Biryani" });
    expect(findDuplicateOffer("biz-1", "Mutton Biryani", "FOOD", [existing], NOW)).toBeNull();
    expect(findDuplicateOffer("biz-1", "Chicken Biryani", "GROCERY", [existing], NOW)).toBeNull();
  });

  it("never flags an expired/ended offer — a genuinely new post is allowed", () => {
    const ended = offer({ id: "ended", businessId: "biz-1", category: "FOOD", title: "Chicken Biryani", status: "ENDED" });
    expect(findDuplicateOffer("biz-1", "Chicken Biryani", "FOOD", [ended], NOW)).toBeNull();
  });
});

describe("formatDistanceLabel", () => {
  it("shows meters under 1km, km above", () => {
    expect(formatDistanceLabel(0.7)).toBe("700 m");
    expect(formatDistanceLabel(1.2)).toBe("1.2 km");
  });
});
