import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { authenticate } from "./testHelpers";

const app = createApp();
const phone = "+919876500077";

describe("POST /voice/parse", () => {
  afterAll(async () => {
    await prisma.otpChallenge.deleteMany({ where: { phone } });
    await prisma.user.deleteMany({ where: { phone } });
    await prisma.$disconnect();
  });

  it("requires authentication", async () => {
    await request(app).post("/voice/parse").send({ text: "Kumar-ku 2000 credit" }).expect(401);
  });

  it("parses recognized text into a structured transaction without writing to the database", async () => {
    const token = await authenticate(app, phone);
    const res = await request(app)
      .post("/voice/parse")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "Kumar-ku 2000-ku product supply panniruken. 7th date 2000 tharanum." })
      .expect(200);

    expect(res.body.data.intent).toBe("CREATE_CREDIT");
    expect(res.body.data.partyName).toBe("Kumar");
    expect(res.body.data.amount).toBe(2000);

    const creditCount = await prisma.creditTransaction.count();
    expect(creditCount).toBe(0);
  });

  it("rejects text that is too short", async () => {
    const token = await authenticate(app, phone);
    await request(app).post("/voice/parse").set("Authorization", `Bearer ${token}`).send({ text: "a" }).expect(400);
  });
});
