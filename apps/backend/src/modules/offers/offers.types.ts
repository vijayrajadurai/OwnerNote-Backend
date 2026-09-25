export type LocalOfferDto = {
  id: string;
  businessId: string;
  businessName: string;
  category: string;
  offerType: string;
  title: string;
  description: string | null;
  price: number;
  imageUri: string | null;
  todayOnly: boolean;
  timeWindowLabel: string;
  startAt: string;
  expiresAt: string;
  latitude: number;
  longitude: number;
  areaLabel: string;
  status: "ACTIVE" | "ENDED";
  createdAt: string;
  updatedAt: string;
  viewCount: number;
  directionsCount: number;
  callCount: number;
};

export type OfferWithDistanceDto = LocalOfferDto & { distanceKm: number };
