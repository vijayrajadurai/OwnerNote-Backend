import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { authenticate, setUpBusiness } from "./testHelpers";

const app = createApp();

const PHONES = {
  a: "+919876610001",
  b: "+919876610002",
  c: "+919876610003",
  d: "+919876610004",
  e: "+919876610005",
  f: "+919876610006",
  other: "+919876610099",
} as const;

const AMBATTUR = { lat: 13.1143, lon: 80.1548 };

function offsetKm(northKm: number): { lat: number; lon: number } {
  return { lat: AMBATTUR.lat + northKm / 111.32, lon: AMBATTUR.lon };
}

function jsonContainsCoordinateKeys(value: unknown): boolean {
  const raw = JSON.stringify(value);
  return /"(latitude|longitude)"\s*:/i.test(raw);
}

async function resetData() {
  await prisma.groupBuyingInvite.deleteMany({});
  await prisma.groupBuyingMember.deleteMany({});
  await prisma.groupBuyingGroup.deleteMany({});
  await prisma.groupBuyingRequest.deleteMany({});
  await prisma.business.deleteMany({
    where: { owner: { phone: { in: Object.values(PHONES) } } },
  });
  await prisma.otpChallenge.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
  await prisma.user.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
}

async function authFor(phone: string): Promise<string> {
  const token = await authenticate(app, phone);
  await setUpBusiness(app, token, "HARDWARE");
  return token;
}

function auth(token: string, req: request.Test) {
  return req.set("Authorization", `Bearer ${token}`);
}

async function createRequest(
  token: string,
  body: {
    productId: string;
    quantity: number;
    unit?: string;
    requiredDate: string;
    latitude: number;
    longitude: number;
    areaLabel?: string;
    radiusKm?: number;
  },
) {
  return auth(token, request(app).post("/group-buying/requests")).send({
    unit: "bags",
    areaLabel: "Ambattur",
    radiusKm: 5,
    ...body,
  });
}

describe("group buying API", () => {
  beforeEach(async () => {
    await resetData();
  });

  afterAll(async () => {
    await resetData();
    await prisma.$disconnect();
  });

  it("creates and lists the caller's own requests only", async () => {
    const tokenA = await authFor(PHONES.a);
    const tokenB = await authFor(PHONES.b);
    const created = await createRequest(tokenA, {
      productId: "cement",
      quantity: 20,
      requiredDate: "2026-09-30",
      latitude: AMBATTUR.lat,
      longitude: AMBATTUR.lon,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.productId).toBe("cement");

    await createRequest(tokenB, {
      productId: "cement",
      quantity: 50,
      requiredDate: "2026-09-30",
      ...offsetKm(2),
      latitude: offsetKm(2).lat,
      longitude: offsetKm(2).lon,
    });

    const listed = await auth(tokenA, request(app).get("/group-buying/requests"));
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].id).toBe(created.body.data.id);
  });

  it("rejects a duplicate active request for the same product and date", async () => {
    const tokenA = await authFor(PHONES.a);
    const first = await createRequest(tokenA, {
      productId: "cement",
      quantity: 20,
      requiredDate: "2026-09-30",
      latitude: AMBATTUR.lat,
      longitude: AMBATTUR.lon,
    });
    expect(first.status).toBe(201);
    const second = await createRequest(tokenA, {
      productId: "cement",
      quantity: 10,
      requiredDate: "2026-09-30",
      latitude: AMBATTUR.lat,
      longitude: AMBATTUR.lon,
    });
    expect(second.status).toBe(409);
  });

  it("rejects (0,0) as a shop location", async () => {
    const tokenA = await authFor(PHONES.a);
    const res = await createRequest(tokenA, {
      productId: "cement",
      quantity: 20,
      requiredDate: "2026-09-30",
      latitude: 0,
      longitude: 0,
    });
    expect(res.status).toBe(400);
  });

  it("matches Phase 1 §32 across tenants and never leaks coordinates", async () => {
    const tokenA = await authFor(PHONES.a);
    const tokenB = await authFor(PHONES.b);
    const tokenC = await authFor(PHONES.c);
    const tokenD = await authFor(PHONES.d);
    const tokenE = await authFor(PHONES.e);
    const tokenF = await authFor(PHONES.f);

    const a = await createRequest(tokenA, {
      productId: "cement",
      quantity: 20,
      requiredDate: "2026-09-30",
      latitude: AMBATTUR.lat,
      longitude: AMBATTUR.lon,
      radiusKm: 5,
    });
    expect(a.status).toBe(201);

    const bLoc = offsetKm(2);
    const cLoc = offsetKm(3);
    const dLoc = offsetKm(20);
    const eLoc = offsetKm(1);
    const fLoc = offsetKm(8);

    expect(
      (
        await createRequest(tokenB, {
          productId: "cement",
          quantity: 50,
          requiredDate: "2026-09-30",
          latitude: bLoc.lat,
          longitude: bLoc.lon,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await createRequest(tokenC, {
          productId: "cement",
          quantity: 80,
          requiredDate: "2026-10-01",
          latitude: cLoc.lat,
          longitude: cLoc.lon,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await createRequest(tokenD, {
          productId: "cement",
          quantity: 40,
          requiredDate: "2026-09-30",
          latitude: dLoc.lat,
          longitude: dLoc.lon,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await createRequest(tokenE, {
          productId: "paint",
          quantity: 10,
          requiredDate: "2026-09-30",
          latitude: eLoc.lat,
          longitude: eLoc.lon,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await createRequest(tokenF, {
          productId: "cement",
          quantity: 30,
          requiredDate: "2026-09-30",
          latitude: fLoc.lat,
          longitude: fLoc.lon,
        })
      ).status,
    ).toBe(201);

    const matches = await auth(
      tokenA,
      request(app).get(`/group-buying/requests/${a.body.data.id}/matches`),
    );
    expect(matches.status).toBe(200);
    expect(jsonContainsCoordinateKeys(matches.body)).toBe(false);
    expect(matches.body.data.matches).toHaveLength(2);
    expect(matches.body.data.matches.map((m: { quantity: number }) => m.quantity).sort((x: number, y: number) => x - y)).toEqual([
      50, 80,
    ]);
    expect(matches.body.data.totals).toEqual({
      totalQuantity: 150,
      businessCount: 3,
      unit: "bags",
    });
    for (const match of matches.body.data.matches) {
      expect(match).not.toHaveProperty("latitude");
      expect(match).not.toHaveProperty("longitude");
      expect(match.areaLabel).toBe("Ambattur");
    }
  });

  it("joins a group without a financial commitment and cancels owner-only", async () => {
    const tokenA = await authFor(PHONES.a);
    const tokenB = await authFor(PHONES.b);
    const tokenOther = await authFor(PHONES.other);

    const a = await createRequest(tokenA, {
      productId: "cement",
      quantity: 20,
      requiredDate: "2026-09-30",
      latitude: AMBATTUR.lat,
      longitude: AMBATTUR.lon,
    });
    const bLoc = offsetKm(2);
    await createRequest(tokenB, {
      productId: "cement",
      quantity: 50,
      requiredDate: "2026-09-30",
      latitude: bLoc.lat,
      longitude: bLoc.lon,
    });

    const joined = await auth(tokenA, request(app).post(`/group-buying/requests/${a.body.data.id}/join`));
    expect(joined.status).toBe(200);
    expect(joined.body.data.request.status).toBe("JOINED");
    expect(joined.body.data.group.id).toBeTruthy();
    expect(joined.body.data.members.length).toBeGreaterThanOrEqual(1);
    expect(jsonContainsCoordinateKeys(joined.body.data.matches)).toBe(false);
    expect(jsonContainsCoordinateKeys(joined.body.data.members)).toBe(false);
    expect(jsonContainsCoordinateKeys(joined.body.data.group)).toBe(false);

    const stolen = await auth(
      tokenOther,
      request(app).post(`/group-buying/requests/${a.body.data.id}/cancel`),
    );
    expect(stolen.status).toBe(403);

    const cancelled = await auth(
      tokenA,
      request(app).post(`/group-buying/requests/${a.body.data.id}/cancel`),
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe("CANCELLED");
  });

  it("invites nearby same-category shops and records interest with quantity", async () => {
    const tokenA = await authFor(PHONES.a);
    const tokenB = await authFor(PHONES.b);
    const tokenGrocery = await authenticate(app, PHONES.c);
    await setUpBusiness(app, tokenGrocery, "GROCERY");

    const nearby = offsetKm(2);
    await prisma.business.updateMany({
      where: { owner: { phone: PHONES.a } },
      data: { businessName: "A Hardware", latitude: AMBATTUR.lat, longitude: AMBATTUR.lon },
    });
    await prisma.business.updateMany({
      where: { owner: { phone: PHONES.b } },
      data: { businessName: "B Hardware", latitude: nearby.lat, longitude: nearby.lon },
    });
    await prisma.business.updateMany({
      where: { owner: { phone: PHONES.c } },
      data: { businessName: "C Grocery", latitude: nearby.lat, longitude: nearby.lon },
    });

    const created = await createRequest(tokenA, {
      productId: "cement",
      quantity: 20,
      requiredDate: "2026-09-30",
      latitude: AMBATTUR.lat,
      longitude: AMBATTUR.lon,
      radiusKm: 5,
    });
    expect(created.status).toBe(201);

    const inboxB = await auth(tokenB, request(app).get("/group-buying/inbox"));
    expect(inboxB.status).toBe(200);
    expect(inboxB.body.data).toHaveLength(1);
    expect(inboxB.body.data[0].request.shopName).toBe("A Hardware");
    expect(inboxB.body.data[0].request.quantity).toBe(20);
    expect(jsonContainsCoordinateKeys(inboxB.body)).toBe(false);

    const inboxGrocery = await auth(tokenGrocery, request(app).get("/group-buying/inbox"));
    expect(inboxGrocery.body.data).toHaveLength(0);

    const inviteId = inboxB.body.data[0].id as string;
    const responded = await auth(tokenB, request(app).post(`/group-buying/invites/${inviteId}/respond`)).send({
      interested: true,
      quantity: 15,
    });
    expect(responded.status).toBe(200);
    expect(responded.body.data.status).toBe("INTERESTED");
    expect(responded.body.data.quantity).toBe(15);

    const matches = await auth(
      tokenA,
      request(app).get(`/group-buying/requests/${created.body.data.id}/matches`),
    );
    expect(matches.status).toBe(200);
    const bMatch = matches.body.data.matches.find((row: { shopName: string }) => row.shopName === "B Hardware");
    expect(bMatch.interestStatus).toBe("INTERESTED");
    expect(bMatch.quantity).toBe(15);
    expect(bMatch.ownerName).toBeTruthy();
    expect(matches.body.data.totals.totalQuantity).toBe(35);
  });
});
