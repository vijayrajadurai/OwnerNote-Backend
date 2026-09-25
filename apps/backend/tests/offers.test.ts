import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { authenticate } from "./testHelpers";

const app = createApp();

const PHONES = {
  a: "+919876630001",
  b: "+919876630002",
} as const;

const AMBATTUR = { lat: 13.1143, lon: 80.1548 };

async function resetData() {
  await prisma.localOffer.deleteMany({ where: { business: { owner: { phone: { in: Object.values(PHONES) } } } } });
  await prisma.business.deleteMany({ where: { owner: { phone: { in: Object.values(PHONES) } } } });
  await prisma.otpChallenge.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
  await prisma.user.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
}

function auth(token: string, req: request.Test) {
  return req.set("Authorization", `Bearer ${token}`);
}

async function authWithLocation(phone: string, latOffsetKm = 0): Promise<string> {
  const token = await authenticate(app, phone);
  await auth(
    token,
    request(app).put("/business"),
  ).send({
    ownerName: "Test Owner",
    businessName: "Test Shop",
    category: "RESTAURANT_FOOD",
    city: "Chennai",
    latitude: AMBATTUR.lat + latOffsetKm / 111.32,
    longitude: AMBATTUR.lon,
    areaLabel: "Ambattur",
    locationSource: "GPS",
  });
  return token;
}

describe("local offers API", () => {
  beforeEach(async () => {
    await resetData();
  });

  afterAll(async () => {
    await resetData();
    await prisma.$disconnect();
  });

  it("creates an offer, snapshotting the business's own saved location", async () => {
    const token = await authWithLocation(PHONES.a);
    const created = await auth(token, request(app).post("/offers")).send({
      category: "FOOD",
      offerType: "TODAY_OFFER",
      title: "Chicken Biryani",
      price: 99,
      todayOnly: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.outcome).toBe("CREATED");
    expect(created.body.data.offer.areaLabel).toBe("Ambattur");
    expect(created.body.data.offer.latitude).toBeCloseTo(AMBATTUR.lat);
  });

  it("refuses to create an offer before the business has a real saved location", async () => {
    const token = await authenticate(app, PHONES.a);
    await auth(token, request(app).put("/business")).send({
      ownerName: "Test Owner",
      businessName: "Test Shop",
      category: "RESTAURANT_FOOD",
      city: "Chennai",
    });
    const created = await auth(token, request(app).post("/offers")).send({
      category: "FOOD",
      offerType: "TODAY_OFFER",
      title: "Chicken Biryani",
      price: 99,
    });
    expect(created.status).toBe(400);
  });

  it("never creates a duplicate offer — same business, same title+category, still ACTIVE", async () => {
    const token = await authWithLocation(PHONES.a);
    await auth(token, request(app).post("/offers")).send({ category: "FOOD", offerType: "TODAY_OFFER", title: "Chicken Biryani", price: 99 });
    const second = await auth(token, request(app).post("/offers")).send({ category: "FOOD", offerType: "TODAY_OFFER", title: "Chicken Biryani", price: 120 });
    expect(second.body.data.outcome).toBe("DUPLICATE");
  });

  it("never blocks the same title for a different business", async () => {
    const tokenA = await authWithLocation(PHONES.a);
    const tokenB = await authWithLocation(PHONES.b);
    await auth(tokenA, request(app).post("/offers")).send({ category: "FOOD", offerType: "TODAY_OFFER", title: "Chicken Biryani", price: 99 });
    const created = await auth(tokenB, request(app).post("/offers")).send({ category: "FOOD", offerType: "TODAY_OFFER", title: "Chicken Biryani", price: 99 });
    expect(created.body.data.outcome).toBe("CREATED");
  });

  it("nearby discovery returns only real ACTIVE, un-expired offers within radius, nearest first", async () => {
    const tokenNear = await authWithLocation(PHONES.a, 0);
    const tokenFar = await authWithLocation(PHONES.b, 20);
    await auth(tokenNear, request(app).post("/offers")).send({ category: "FOOD", offerType: "TODAY_OFFER", title: "Near Offer", price: 50 });
    await auth(tokenFar, request(app).post("/offers")).send({ category: "FOOD", offerType: "TODAY_OFFER", title: "Far Offer", price: 50 });

    const nearby = await auth(tokenNear, request(app).get("/offers/nearby").query({ latitude: AMBATTUR.lat, longitude: AMBATTUR.lon, radiusKm: 10 }));
    expect(nearby.body.data.map((o: { title: string }) => o.title)).toEqual(["Near Offer"]);
  });

  it("ending an offer removes it from discovery immediately", async () => {
    const token = await authWithLocation(PHONES.a);
    const created = await auth(token, request(app).post("/offers")).send({ category: "FOOD", offerType: "TODAY_OFFER", title: "Chicken Biryani", price: 99 });
    const offerId = created.body.data.offer.id;

    await auth(token, request(app).post(`/offers/${offerId}/end`));
    const nearby = await auth(token, request(app).get("/offers/nearby").query({ latitude: AMBATTUR.lat, longitude: AMBATTUR.lon, radiusKm: 10 }));
    expect(nearby.body.data).toHaveLength(0);
  });

  it("records real view/directions/call counters, never estimated numbers", async () => {
    const token = await authWithLocation(PHONES.a);
    const created = await auth(token, request(app).post("/offers")).send({ category: "FOOD", offerType: "TODAY_OFFER", title: "Chicken Biryani", price: 99 });
    const offerId = created.body.data.offer.id;

    await auth(token, request(app).post(`/offers/${offerId}/view`));
    await auth(token, request(app).post(`/offers/${offerId}/view`));
    await auth(token, request(app).post(`/offers/${offerId}/directions`));

    const fetched = await auth(token, request(app).get(`/offers/${offerId}`));
    expect(fetched.body.data.viewCount).toBe(2);
    expect(fetched.body.data.directionsCount).toBe(1);
    expect(fetched.body.data.callCount).toBe(0);
  });

  it("lists only the caller's own offers", async () => {
    const tokenA = await authWithLocation(PHONES.a);
    const tokenB = await authWithLocation(PHONES.b);
    await auth(tokenA, request(app).post("/offers")).send({ category: "FOOD", offerType: "TODAY_OFFER", title: "A's Offer", price: 10 });
    await auth(tokenB, request(app).post("/offers")).send({ category: "FOOD", offerType: "TODAY_OFFER", title: "B's Offer", price: 10 });

    const mine = await auth(tokenA, request(app).get("/offers/mine"));
    expect(mine.body.data.map((o: { title: string }) => o.title)).toEqual(["A's Offer"]);
  });
});
