/**
 * Public match DTO. This type is intentionally incapable of carrying
 * latitude/longitude — other businesses' exact coordinates must never
 * leave the server.
 */
export type GroupBuyingMatchPublic = {
  requestId: string;
  businessId: string;
  shopName: string;
  ownerName: string;
  phone: string;
  areaLabel: string;
  quantity: number;
  unit: string;
  requiredDate: string;
  distanceKm: number;
  interestStatus: string;
};

export type GroupBuyingTotals = {
  totalQuantity: number;
  businessCount: number;
  unit: string;
};

export type GroupBuyingMatchesResponse = {
  matches: GroupBuyingMatchPublic[];
  totals: GroupBuyingTotals;
};

/** In-memory request shape used by the matching engine (includes coords). */
export type MatchableGroupBuyingRequest = {
  id: string;
  businessId: string;
  productId: string;
  quantity: number;
  unit: string;
  requiredDate: string;
  latitude: number;
  longitude: number;
  areaLabel: string;
  radiusKm: number;
  status: string;
};
