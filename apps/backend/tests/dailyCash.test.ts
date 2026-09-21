import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { authenticate, setUpBusiness } from "./testHelpers";

const app = createApp();

describe("daily cash reports", () => {
  it("submits and fetches an end-of-day report", async () => {
    const token = await authenticate(app, "+919876543210");
    await setUpBusiness(app, token);

    const payload = {
      date: "2026-09-21",
      totalIn: 300,
      totalOut: 100,
      net: 200,
      cashIn: 100,
      cashOut: 30,
      upiIn: 200,
      upiOut: 70,
      entries: [
        {
          type: "IN",
          amount: 100,
          paymentMode: "CASH",
          note: "Morning sale",
          createdAt: "2026-09-21T08:00:00.000Z",
        },
        {
          type: "OUT",
          amount: 30,
          paymentMode: "CASH",
          createdAt: "2026-09-21T12:00:00.000Z",
        },
      ],
    };

    const submitRes = await request(app)
      .post("/daily-cash/reports")
      .set("Authorization", `Bearer ${token}`)
      .send(payload)
      .expect(201);

    expect(submitRes.body.data.date).toBe("2026-09-21");
    expect(submitRes.body.data.net).toBe(200);
    expect(submitRes.body.data.entries).toHaveLength(2);

    const getRes = await request(app)
      .get("/daily-cash/reports/2026-09-21")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(getRes.body.data.totalIn).toBe(300);
  });

  it("upserts the same date idempotently", async () => {
    const token = await authenticate(app, "+919876543211");
    await setUpBusiness(app, token);

    const base = {
      date: "2026-09-20",
      totalIn: 50,
      totalOut: 0,
      net: 50,
      cashIn: 50,
      cashOut: 0,
      upiIn: 0,
      upiOut: 0,
      entries: [
        {
          type: "IN",
          amount: 50,
          paymentMode: "CASH",
          createdAt: "2026-09-20T10:00:00.000Z",
        },
      ],
    };

    await request(app)
      .post("/daily-cash/reports")
      .set("Authorization", `Bearer ${token}`)
      .send(base)
      .expect(201);

    const updated = { ...base, totalIn: 80, net: 80, cashIn: 80, entries: [{ ...base.entries[0], amount: 80 }] };
    const res = await request(app)
      .post("/daily-cash/reports")
      .set("Authorization", `Bearer ${token}`)
      .send(updated)
      .expect(201);

    expect(res.body.data.totalIn).toBe(80);
    expect(res.body.data.entries).toHaveLength(1);
  });
});
