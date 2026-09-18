import bcrypt from "bcryptjs";
import { prisma } from "../../db/prisma";
import { env } from "../../config/env";
import { getOtpProvider } from "./otp.provider";
import { signAuthToken } from "../../utils/jwt";
import { NotFoundError, UnauthorizedError, ValidationError } from "../../utils/errors";

const PHONE_REGEX = /^\+?[1-9]\d{9,14}$/;

function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (!PHONE_REGEX.test(trimmed)) {
    throw new ValidationError("Enter a valid phone number, e.g. +919876543210");
  }
  return trimmed.startsWith("+") ? trimmed : `+91${trimmed}`;
}

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function requestOtp(rawPhone: string): Promise<{ phone: string; expiresInSeconds: number }> {
  const phone = normalizePhone(rawPhone);
  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + env.OTP_TTL_SECONDS * 1000);

  await prisma.otpChallenge.create({
    data: { phone, codeHash, expiresAt },
  });

  await getOtpProvider().sendOtp(phone, code);

  return { phone, expiresInSeconds: env.OTP_TTL_SECONDS };
}

export async function verifyOtp(rawPhone: string, code: string): Promise<{ token: string; isNewUser: boolean }> {
  const phone = normalizePhone(rawPhone);

  const challenge = await prisma.otpChallenge.findFirst({
    where: { phone, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge) {
    throw new UnauthorizedError("No pending OTP for this number. Request a new one.");
  }

  if (challenge.expiresAt < new Date()) {
    throw new UnauthorizedError("OTP expired. Request a new one.");
  }

  if (challenge.attempts >= env.OTP_MAX_ATTEMPTS) {
    throw new UnauthorizedError("Too many incorrect attempts. Request a new OTP.");
  }

  const isValid = await bcrypt.compare(code, challenge.codeHash);

  if (!isValid) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    throw new UnauthorizedError("Incorrect OTP");
  }

  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  let user = await prisma.user.findUnique({ where: { phone } });
  let isNewUser = false;
  if (!user) {
    user = await prisma.user.create({ data: { phone } });
    isNewUser = true;
  }

  const token = signAuthToken({ userId: user.id, role: user.role });
  return { token, isNewUser };
}

// Fixed, non-phone identifier for the single test-login account — kept
// separate from any real phone number so it can never collide with a
// real user created via the OTP flow.
const TEST_LOGIN_PHONE = "+910000000000";

export async function testLogin(username: string, password: string): Promise<{ token: string; isNewUser: boolean }> {
  if (!env.TEST_LOGIN_ENABLED) {
    throw new UnauthorizedError("Test login is not enabled.");
  }
  if (username !== env.TEST_LOGIN_USERNAME || password !== env.TEST_LOGIN_PASSWORD) {
    throw new UnauthorizedError("Incorrect test login username or password.");
  }

  let user = await prisma.user.findUnique({ where: { phone: TEST_LOGIN_PHONE } });
  let isNewUser = false;
  if (!user) {
    user = await prisma.user.create({ data: { phone: TEST_LOGIN_PHONE } });
    isNewUser = true;
  }

  const token = signAuthToken({ userId: user.id, role: user.role });
  return { token, isNewUser };
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { business: { select: { businessName: true } }, salesOfficerProfile: true },
  });
  if (!user) throw new NotFoundError("User not found");

  return {
    id: user.id,
    phone: user.phone,
    role: user.role,
    businessName: user.business?.businessName ?? null,
    salesOfficerName: user.salesOfficerProfile?.name ?? null,
    salesOfficerProfileId: user.salesOfficerProfile?.id ?? null,
  };
}
