import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { authenticate } from "./testHelpers";

const app = createApp();
const phone = "+919876500432";

const base = { ownerName: "Murugan", businessName: "Murugan Saloon", category: "BEAUTY_SALON", city: "Salem" };

/** Owner, 21 Oct 2026: the business's types (Service / Retail / Wholesale) decide which features the app shows. */
describe("business types", () => {
  beforeEach(async () => {
    await prisma.business.deleteMany({ where: { owner: { phone } } });
    await prisma.otpChallenge.deleteMany({ where: { phone } });
    await prisma.user.deleteMany({ where: { phone } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps every type picked, once", async () => {
    const token = await authenticate(app, phone);
    const put = await request(app)
      .put("/business")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...base, businessTypes: ["SERVICE", "RETAIL", "SERVICE"] })
      .expect(200);
    expect(put.body.data.businessTypes).toEqual(["SERVICE", "RETAIL"]);
    const got = await request(app).get("/business").set("Authorization", `Bearer ${token}`).expect(200);
    expect(got.body.data.businessTypes).toEqual(["SERVICE", "RETAIL"]);
  });

  it("starts empty, and an older app's save leaves the types as they are", async () => {
    const token = await authenticate(app, phone);
    const first = await request(app).put("/business").set("Authorization", `Bearer ${token}`).send(base).expect(200);
    expect(first.body.data.businessTypes).toEqual([]);
    await request(app).put("/business").set("Authorization", `Bearer ${token}`).send({ ...base, businessTypes: ["WHOLESALE"] }).expect(200);
    const older = await request(app).put("/business").set("Authorization", `Bearer ${token}`).send({ ...base, city: "Erode" }).expect(200);
    expect(older.body.data.city).toBe("Erode");
    expect(older.body.data.businessTypes).toEqual(["WHOLESALE"]);
  });

  it("refuses a type it does not know (never read as another one)", async () => {
    const token = await authenticate(app, phone);
    for (const bad of [["DISTRIBUTOR"], ["service"], [""], ["SERVICE", "RETAIL", "WHOLESALE", "SPA"]]) {
      await request(app).put("/business").set("Authorization", `Bearer ${token}`).send({ ...base, businessTypes: bad }).expect(400);
    }
  });
});
