import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { authenticate } from "./testHelpers";

const app = createApp();
const phone = "+919876500431";

const base = { ownerName: "Selvi", businessName: "Selvi Stores", category: "GROCERY", city: "Madurai" };

/** Owner, 20 Oct 2026: several product business categories at setup, and a name for "Other Product Businesses". */
describe("business categories", () => {
  beforeEach(async () => {
    await prisma.business.deleteMany({ where: { owner: { phone } } });
    await prisma.otpChallenge.deleteMany({ where: { phone } });
    await prisma.user.deleteMany({ where: { phone } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps every category picked, once, and the owner's own name for Other", async () => {
    const token = await authenticate(app, phone);
    const put = await request(app)
      .put("/business")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...base, categories: ["GROCERY_FMCG", "BAKERY_CONFECTIONERY", "GROCERY_FMCG", "OTHER_PRODUCTS"], otherCategoryName: "  Pooja items " })
      .expect(200);
    expect(put.body.data.categories).toEqual(["GROCERY_FMCG", "BAKERY_CONFECTIONERY", "OTHER_PRODUCTS"]);
    expect(put.body.data.otherCategoryName).toBe("Pooja items");

    const got = await request(app).get("/business").set("Authorization", `Bearer ${token}`).expect(200);
    expect(got.body.data.category).toBe("GROCERY");
    expect(got.body.data.categories).toEqual(["GROCERY_FMCG", "BAKERY_CONFECTIONERY", "OTHER_PRODUCTS"]);
  });

  it("leaves the categories as they are when an older app saves without them", async () => {
    const token = await authenticate(app, phone);
    await request(app).put("/business").set("Authorization", `Bearer ${token}`).send({ ...base, categories: ["PHARMACY_MEDICAL"] }).expect(200);
    const put = await request(app).put("/business").set("Authorization", `Bearer ${token}`).send({ ...base, city: "Trichy" }).expect(200);
    expect(put.body.data.city).toBe("Trichy");
    expect(put.body.data.categories).toEqual(["PHARMACY_MEDICAL"]);
  });

  it("starts with no categories for a business set up the old way", async () => {
    const token = await authenticate(app, phone);
    const put = await request(app).put("/business").set("Authorization", `Bearer ${token}`).send(base).expect(200);
    expect(put.body.data.categories).toEqual([]);
    expect(put.body.data.otherCategoryName).toBeNull();
  });

  it("refuses a code that is not a category code, and an empty Other name", async () => {
    const token = await authenticate(app, phone);
    for (const bad of [["grocery fmcg"], ["1ABC"], [""], Array.from({ length: 41 }, (_, i) => `CAT_${i}`)]) {
      await request(app).put("/business").set("Authorization", `Bearer ${token}`).send({ ...base, categories: bad }).expect(400);
    }
    await request(app).put("/business").set("Authorization", `Bearer ${token}`).send({ ...base, otherCategoryName: " " }).expect(400);
  });
});
