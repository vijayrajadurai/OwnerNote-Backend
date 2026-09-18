import { Router } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { env } from "../../config/env";
import { parseVoiceText } from "./voice.controller";

const parseLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  message: { error: { code: "RATE_LIMITED", message: "Too many voice entries. Slow down a bit." } },
});

export const voiceRouter = Router();

voiceRouter.use(requireAuth);
voiceRouter.post("/parse", parseLimiter, asyncHandler(parseVoiceText));
