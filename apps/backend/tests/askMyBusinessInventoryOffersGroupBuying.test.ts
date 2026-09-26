import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { authenticate } from "./testHelpers";

const app = createApp();

const PHONES = {
  a: "+919876640001",
} as const;

const AMBATTUR = { lat: 13.1143, lon: 80.1548 };

async function resetData() {
  await prisma.groupBuyingRequest.deleteMany({});
  await prisma.localOffer.deleteMany({});
  await prisma.inventoryMovement.deleteMany({});
  await prisma.inventoryProduct.deleteMany({});
  await prisma.business.deleteMany({ where: { owner: { phone: { in: Object.values(PHONES) } } } });
  await prisma.otpChallenge.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
  await prisma.user.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
}

function auth(token: string, req: request.Test) {
  return req.set("Authorization", `Bearer ${token}`);
}

async function authWithLocation(phone: string): Promise<string> {
  const token = await authenticate(app, phone);
  await auth(token, request(app).put("/business")).send({
    ownerName: "Test Owner",
    businessName: "Test Shop",
    category: "HARDWARE",
    city: "Chennai",
    latitude: AMBATTUR.lat,
    longitude: AMBATTUR.lon,
    areaLabel: "Ambattur",
    locationSource: "GPS",
  });
  return token;
}

function ask(token: string, question: string) {
  return auth(token, request(app).post("/ask-my-business")).send({ question });
}

describe("Ask My Business — Inventory / Local Offers / Group Buying awareness", () => {
  beforeEach(async () => {
    await resetData();
  });

  afterAll(async () => {
    await resetData();
    await prisma.$disconnect();
  });

  it("answers a real product's stock level from the actual inventory row", async () => {
    const token = await authWithLocation(PHONES.a);
    await auth(token, request(app).post("/inventory/products")).send({
      name: "Cement",
      category: "Construction",
      unit: "BAG",
      currentStock: 82,
    });

    const res = await ask(token, "Cement stock evlo?");
    expect(res.status).toBe(200);
    expect(res.body.data.matchedIntent).toBe("INVENTORY_STOCK_QUERY");
    expect(res.body.data.answer).toBe("Cement: 82 BAG in stock.");
  });

  it("answers honestly when the named product doesn't exist — never fabricates a number", async () => {
    const token = await authWithLocation(PHONES.a);
    const res = await ask(token, "Steel stock evlo?");
    expect(res.body.data.matchedIntent).toBe("INVENTORY_STOCK_QUERY");
    expect(res.body.data.answer).toMatch(/couldn't find/i);
  });

  it("answers honestly when there are no active local offers yet", async () => {
    const token = await authWithLocation(PHONES.a);
    const res = await ask(token, "Do I have any active offers?");
    expect(res.body.data.matchedIntent).toBe("LOCAL_OFFER_QUERY");
    expect(res.body.data.answer).toMatch(/no active local offers/i);
  });

  it("lists a real posted offer, never an invented one", async () => {
    const token = await authWithLocation(PHONES.a);
    await auth(token, request(app).post("/offers")).send({ category: "FOOD", offerType: "TODAY_OFFER", title: "Chicken Biryani", price: 99 });

    const res = await ask(token, "What offers do I have posted?");
    expect(res.body.data.matchedIntent).toBe("LOCAL_OFFER_QUERY");
    expect(res.body.data.answer).toContain("Chicken Biryani");
    expect(res.body.data.answer).toContain("1 active offer");
  });

  it("answers honestly when there are no open group-buying requests yet", async () => {
    const token = await authWithLocation(PHONES.a);
    const res = await ask(token, "Any group buying requests open?");
    expect(res.body.data.matchedIntent).toBe("GROUP_BUYING_QUERY");
    expect(res.body.data.answer).toMatch(/no open group-buying requests/i);
  });

  it("lists a real posted group-buying request, never an invented one", async () => {
    const token = await authWithLocation(PHONES.a);
    await auth(token, request(app).post("/group-buying/requests")).send({
      productId: "cement",
      quantity: 20,
      unit: "bags",
      requiredDate: "2026-09-30",
      latitude: AMBATTUR.lat,
      longitude: AMBATTUR.lon,
      areaLabel: "Ambattur",
      radiusKm: 5,
    });

    const res = await ask(token, "Any group buying requests open?");
    expect(res.body.data.matchedIntent).toBe("GROUP_BUYING_QUERY");
    expect(res.body.data.answer).toContain("cement (20 bags)");
    expect(res.body.data.answer).toContain("1 open group-buying request");
  });

  it("never lets 'stock'/'offer'/'group buying' vocabulary steal an unrelated existing intent", async () => {
    const token = await authWithLocation(PHONES.a);
    const res = await ask(token, "Yaar kitta cash collect pannanum?");
    expect(res.body.data.matchedIntent).toBe("WHO_TO_COLLECT");
  });
});
