import { Router } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { env } from "../../config/env";
import { parseOcrText } from "./ocr.controller";

const parseLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  message: { error: { code: "RATE_LIMITED", message: "Too many OCR requests. Slow down a bit." } },
});

export const ocrRouter = Router();

ocrRouter.use(requireAuth);
ocrRouter.post("/parse", parseLimiter, asyncHandler(parseOcrText));
