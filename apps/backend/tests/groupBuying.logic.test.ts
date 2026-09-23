import { describe, expect, it } from "vitest";
import {
  computeGroupTotals,
  findDuplicateRequest,
  findNearbyMatches,
  haversineKm,
  isCompatibleRequiredDate,
  roundDistanceKm,
} from "../src/modules/groupBuying/groupBuying.logic";
import type { GroupBuyingMatchPublic } from "../src/modules/groupBuying/groupBuying.types";
import type { MatchableGroupBuyingRequest } from "../src/modules/groupBuying/groupBuying.types";

type Forbidden = Extract<keyof GroupBuyingMatchPublic, "latitude" | "longitude">;
const matchDtoHasNoCoordinates: [Forbidden] extends [never] ? true : false = true;

const AMBATTUR = { lat: 13.1143, lon: 80.1548 };

function offsetKm(lat: number, lon: number, northKm: number): { lat: number; lon: number } {
  return { lat: lat + northKm / 111.32, lon };
}

function request(
  overrides: Partial<MatchableGroupBuyingRequest> & Pick<MatchableGroupBuyingRequest, "id" | "businessId">,
): MatchableGroupBuyingRequest {
  return {
    productId: "cement",
    quantity: 20,
    unit: "bags",
    requiredDate: "2026-09-30",
    latitude: AMBATTUR.lat,
    longitude: AMBATTUR.lon,
    areaLabel: "Ambattur",
    radiusKm: 5,
    status: "ACTIVE",
    ...overrides,
  };
}

describe("group buying match DTO privacy", () => {
  it("TypeScript type GroupBuyingMatchPublic has no latitude/longitude fields", () => {
    expect(matchDtoHasNoCoordinates).toBe(true);
    const sample: GroupBuyingMatchPublic = {
      requestId: "r1",
      businessId: "b1",
      areaLabel: "Ambattur",
      quantity: 50,
      unit: "bags",
      requiredDate: "2026-09-30",
      distanceKm: 2.0,
    };
    expect(Object.keys(sample).sort()).toEqual(
      ["areaLabel", "businessId", "distanceKm", "quantity", "requestId", "requiredDate", "unit"].sort(),
    );
  });
});

describe("group buying matching engine", () => {
  it("computes haversine distance in kilometres", () => {
    const b = offsetKm(AMBATTUR.lat, AMBATTUR.lon, 2);
    const km = haversineKm(AMBATTUR.lat, AMBATTUR.lon, b.lat, b.lon);
    expect(km).toBeGreaterThan(1.9);
    expect(km).toBeLessThan(2.1);
    expect(roundDistanceKm(km)).toBe(2);
  });

  it("treats required dates within one local day as compatible", () => {
    expect(isCompatibleRequiredDate("2026-09-30", "2026-09-30")).toBe(true);
    expect(isCompatibleRequiredDate("2026-09-30", "2026-10-01")).toBe(true);
    expect(isCompatibleRequiredDate("2026-09-30", "2026-10-02")).toBe(false);
  });

  it("matches Phase 1 §32 Ambattur cement scenario in memory", () => {
    const origin = request({ id: "a", businessId: "biz-a", quantity: 20 });
    const b = offsetKm(AMBATTUR.lat, AMBATTUR.lon, 2);
    const c = offsetKm(AMBATTUR.lat, AMBATTUR.lon, 3);
    const d = offsetKm(AMBATTUR.lat, AMBATTUR.lon, 20);
    const e = offsetKm(AMBATTUR.lat, AMBATTUR.lon, 1);
    const f = offsetKm(AMBATTUR.lat, AMBATTUR.lon, 8);
    const matches = findNearbyMatches(origin, [
      request({ id: "b", businessId: "biz-b", quantity: 50, latitude: b.lat, longitude: b.lon }),
      request({
        id: "c",
        businessId: "biz-c",
        quantity: 80,
        requiredDate: "2026-10-01",
        latitude: c.lat,
        longitude: c.lon,
      }),
      request({ id: "d", businessId: "biz-d", quantity: 40, latitude: d.lat, longitude: d.lon }),
      request({
        id: "e",
        businessId: "biz-e",
        productId: "paint",
        quantity: 10,
        latitude: e.lat,
        longitude: e.lon,
      }),
      request({ id: "f", businessId: "biz-f", quantity: 30, latitude: f.lat, longitude: f.lon }),
    ]);

    expect(matches.map((m) => m.businessId)).toEqual(["biz-b", "biz-c"]);
    expect(computeGroupTotals(origin, matches)).toEqual({
      totalQuantity: 150,
      businessCount: 3,
      unit: "bags",
    });
  });

  it("finds an active duplicate for the same business, product, and date", () => {
    const existing = [request({ id: "a", businessId: "biz-a", status: "ACTIVE" })];
    expect(findDuplicateRequest(existing, { businessId: "biz-a", productId: "cement", requiredDate: "2026-09-30" })?.id).toBe(
      "a",
    );
    expect(
      findDuplicateRequest(existing, { businessId: "biz-a", productId: "paint", requiredDate: "2026-09-30" }),
    ).toBeNull();
  });
});
