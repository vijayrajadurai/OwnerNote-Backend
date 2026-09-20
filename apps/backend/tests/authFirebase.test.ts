import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { UnauthorizedError } from "../src/utils/errors";
import { setFirebaseIdTokenVerifierForTests } from "../src/modules/auth/firebase.admin";

const app = createApp();
const phone = "+919876500088";

describe("Firebase phone login", () => {
  beforeEach(async () => {
    await prisma.business.deleteMany({});
    await prisma.otpChallenge.deleteMany({ where: { phone } });
    await prisma.user.deleteMany({ where: { phone } });
    setFirebaseIdTokenVerifierForTests(async (idToken) => {
      if (idToken === "valid-firebase-id-token-0001") {
        return { phone, firebaseUid: "firebase-uid-1" };
      }
      throw new UnauthorizedError("Invalid or expired Firebase ID token.");
    });
  });

  afterEach(() => {
    setFirebaseIdTokenVerifierForTests(null);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("issues an app JWT for a verified Firebase ID token", async () => {
    const res = await request(app)
      .post("/auth/firebase")
      .send({ idToken: "valid-firebase-id-token-0001" })
      .expect(200);

    expect(res.body.data.token).toBeTypeOf("string");
    expect(res.body.data.isNewUser).toBe(true);

    const second = await request(app)
      .post("/auth/firebase")
      .send({ idToken: "valid-firebase-id-token-0001" })
      .expect(200);
    expect(second.body.data.isNewUser).toBe(false);
  });

  it("rejects an invalid Firebase ID token", async () => {
    const res = await request(app).post("/auth/firebase").send({ idToken: "invalid-firebase-id-token-xx" });
    expect(res.status).toBe(401);
  });

  it("rejects a missing idToken", async () => {
    await request(app).post("/auth/firebase").send({}).expect(400);
  });
});
