import { Router } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../../config/env";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { getMe, sendOtp, testLoginHandler, verifyOtpHandler } from "./auth.controller";

// Rate limiting is disabled under test so the suite isn't at the mercy of
// shared-IP throttling; it stays fully active in development/production.
const skipInTest = () => env.NODE_ENV === "test";

const otpRequestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: { code: "RATE_LIMITED", message: "Too many OTP requests. Try again shortly." } },
});

const otpVerifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: { code: "RATE_LIMITED", message: "Too many attempts. Try again shortly." } },
});

// Same shape as otpVerifyLimiter — a fixed-credential endpoint still
// deserves brute-force protection, even though it only ever runs with
// TEST_LOGIN_ENABLED=true (never in production; see src/config/env.ts).
const testLoginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: { code: "RATE_LIMITED", message: "Too many attempts. Try again shortly." } },
});

export const authRouter = Router();

authRouter.post("/send-otp", otpRequestLimiter, asyncHandler(sendOtp));
authRouter.post("/verify-otp", otpVerifyLimiter, asyncHandler(verifyOtpHandler));
authRouter.post("/test-login", testLoginLimiter, asyncHandler(testLoginHandler));
authRouter.get("/me", requireAuth, asyncHandler(getMe));
