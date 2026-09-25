import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { authenticate, setUpBusiness } from "./testHelpers";

const app = createApp();

const PHONES = {
  a: "+919876620001",
  b: "+919876620002",
} as const;

async function resetData() {
  await prisma.inventoryMovement.deleteMany({ where: { product: { business: { owner: { phone: { in: Object.values(PHONES) } } } } } });
  await prisma.inventoryProduct.deleteMany({ where: { business: { owner: { phone: { in: Object.values(PHONES) } } } } });
  await prisma.business.deleteMany({ where: { owner: { phone: { in: Object.values(PHONES) } } } });
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

describe("inventory API", () => {
  beforeEach(async () => {
    await resetData();
  });

  afterAll(async () => {
    await resetData();
    await prisma.$disconnect();
  });

  it("creates a product with a real opening-stock movement when currentStock > 0", async () => {
    const token = await authFor(PHONES.a);
    const created = await auth(token, request(app).post("/inventory/products")).send({
      name: "Cement",
      category: "Construction",
      unit: "BAG",
      currentStock: 50,
      minimumStock: 20,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.outcome).toBe("CREATED");
    const productId = created.body.data.product.id;

    const movements = await auth(token, request(app).get(`/inventory/products/${productId}/movements`));
    expect(movements.body.data).toHaveLength(1);
    expect(movements.body.data[0].type).toBe("IN");
    expect(movements.body.data[0].quantity).toBe(50);
    expect(movements.body.data[0].reason).toBe("OPENING_STOCK");
  });

  it("never creates a duplicate product for the same business — same name, case-insensitive", async () => {
    const token = await authFor(PHONES.a);
    await auth(token, request(app).post("/inventory/products")).send({ name: "Cement", category: "Construction", unit: "BAG" });
    const second = await auth(token, request(app).post("/inventory/products")).send({ name: "  CEMENT  ", category: "Construction", unit: "BAG" });
    expect(second.body.data.outcome).toBe("DUPLICATE");
  });

  it("never blocks the same product name for a different business", async () => {
    const tokenA = await authFor(PHONES.a);
    const tokenB = await authFor(PHONES.b);
    await auth(tokenA, request(app).post("/inventory/products")).send({ name: "Cement", category: "Construction", unit: "BAG" });
    const created = await auth(tokenB, request(app).post("/inventory/products")).send({ name: "Cement", category: "Construction", unit: "BAG" });
    expect(created.body.data.outcome).toBe("CREATED");
  });

  it("lists only the caller's own products", async () => {
    const tokenA = await authFor(PHONES.a);
    const tokenB = await authFor(PHONES.b);
    await auth(tokenA, request(app).post("/inventory/products")).send({ name: "Cement", category: "Construction", unit: "BAG" });
    await auth(tokenB, request(app).post("/inventory/products")).send({ name: "Steel", category: "Construction", unit: "TON" });

    const listA = await auth(tokenA, request(app).get("/inventory/products"));
    expect(listA.body.data.map((p: { name: string }) => p.name)).toEqual(["Cement"]);
  });

  it("addStock increases currentStock and records a real IN movement with the given reason", async () => {
    const token = await authFor(PHONES.a);
    const created = await auth(token, request(app).post("/inventory/products")).send({ name: "Cement", category: "Construction", unit: "BAG", currentStock: 10 });
    const productId = created.body.data.product.id;

    const result = await auth(token, request(app).post(`/inventory/products/${productId}/stock-in`)).send({ quantity: 40, reason: "PURCHASE" });
    expect(result.body.data.outcome).toBe("OK");
    expect(result.body.data.product.currentStock).toBe(50);
  });

  it("removeStock never allows currentStock to go negative", async () => {
    const token = await authFor(PHONES.a);
    const created = await auth(token, request(app).post("/inventory/products")).send({ name: "Cement", category: "Construction", unit: "BAG", currentStock: 10 });
    const productId = created.body.data.product.id;

    const result = await auth(token, request(app).post(`/inventory/products/${productId}/stock-out`)).send({ quantity: 20, reason: "SALE" });
    expect(result.body.data.outcome).toBe("INSUFFICIENT_STOCK");
    expect(result.body.data.available).toBe(10);

    const unchanged = await auth(token, request(app).get(`/inventory/products/${productId}`));
    expect(unchanged.body.data.currentStock).toBe(10);
  });

  it("removeStock accepts a valid removal and records a real OUT movement", async () => {
    const token = await authFor(PHONES.a);
    const created = await auth(token, request(app).post("/inventory/products")).send({ name: "Cement", category: "Construction", unit: "BAG", currentStock: 50 });
    const productId = created.body.data.product.id;

    const result = await auth(token, request(app).post(`/inventory/products/${productId}/stock-out`)).send({ quantity: 20, reason: "SALE" });
    expect(result.body.data.outcome).toBe("OK");
    expect(result.body.data.product.currentStock).toBe(30);
  });

  it("accepts an occurredAt override for Free-First Manual Entry's Quick Stock date field", async () => {
    const token = await authFor(PHONES.a);
    const created = await auth(token, request(app).post("/inventory/products")).send({ name: "Cement", category: "Construction", unit: "BAG", currentStock: 50 });
    const productId = created.body.data.product.id;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await auth(token, request(app).post(`/inventory/products/${productId}/stock-in`)).send({ quantity: 10, reason: "PURCHASE", occurredAt: yesterday.toISOString() });

    const movements = await auth(token, request(app).get(`/inventory/products/${productId}/movements`));
    const backdated = movements.body.data.find((m: { reason: string }) => m.reason === "PURCHASE");
    expect(new Date(backdated.createdAt).toDateString()).toBe(yesterday.toDateString());
  });

  it("only ever returns products currently at or below their own minimumStock as low-stock", async () => {
    const token = await authFor(PHONES.a);
    await auth(token, request(app).post("/inventory/products")).send({ name: "Cement", category: "Construction", unit: "BAG", currentStock: 5, minimumStock: 20 });
    await auth(token, request(app).post("/inventory/products")).send({ name: "Steel", category: "Construction", unit: "TON", currentStock: 100, minimumStock: 20 });

    const lowStock = await auth(token, request(app).get("/inventory/products/low-stock"));
    expect(lowStock.body.data.map((p: { name: string }) => p.name)).toEqual(["Cement"]);
  });

  it("AI Stock Intelligence summary never fabricates attention products beyond real low/out-of-stock rows", async () => {
    const token = await authFor(PHONES.a);
    await auth(token, request(app).post("/inventory/products")).send({ name: "Cement", category: "Construction", unit: "BAG", currentStock: 0, minimumStock: 20 });
    await auth(token, request(app).post("/inventory/products")).send({ name: "Steel", category: "Construction", unit: "TON", currentStock: 100, minimumStock: 20 });

    const summary = await auth(token, request(app).get("/inventory/intelligence/summary"));
    expect(summary.body.data.outOfStockCount).toBe(1);
    expect(summary.body.data.healthyCount).toBe(1);
    expect(summary.body.data.attentionProducts).toHaveLength(1);
    expect(summary.body.data.attentionProducts[0].productName).toBe("Cement");
  });
});
