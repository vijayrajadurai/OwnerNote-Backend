import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { authenticate } from "./testHelpers";
import { prisma } from "../src/db/prisma";

const app = createApp();
const sampleToken = `fcm-test-token-${"x".repeat(40)}`;

describe("device FCM tokens", () => {
  it("stores and unregisters an FCM token for the authenticated user", async () => {
    const token = await authenticate(app, "+919876540001");
    const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`).expect(200);
    const userId = me.body.data.id as string;

    await request(app)
      .post("/devices/fcm")
      .set("Authorization", `Bearer ${token}`)
      .send({ token: sampleToken, platform: "ANDROID" })
      .expect(200);

    const stored = await prisma.deviceToken.findUnique({ where: { token: sampleToken } });
    expect(stored?.userId).toBe(userId);

    await request(app)
      .post("/devices/fcm")
      .set("Authorization", `Bearer ${token}`)
      .send({ token: sampleToken, platform: "ANDROID" })
      .expect(200);

    const count = await prisma.deviceToken.count({ where: { userId, token: sampleToken } });
    expect(count).toBe(1);

    await request(app)
      .post("/devices/fcm/unregister")
      .set("Authorization", `Bearer ${token}`)
      .send({ token: sampleToken })
      .expect(200);

    const gone = await prisma.deviceToken.findUnique({ where: { token: sampleToken } });
    expect(gone).toBeNull();
  });

  it("rejects unauthenticated registration", async () => {
    await request(app).post("/devices/fcm").send({ token: sampleToken }).expect(401);
  });
});
