import { Router } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../../config/env";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  createOfferHandler,
  endOfferHandler,
  getNearbyOffersHandler,
  getOfferHandler,
  listMyOffersHandler,
  recordCallHandler,
  recordDirectionsHandler,
  recordViewHandler,
  updateOfferHandler,
} from "./offers.controller";

const skipInTest = () => env.NODE_ENV === "test";

const createOfferLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: { code: "RATE_LIMITED", message: "Too many offers posted. Try again shortly." } },
});

export const offersRouter = Router();

offersRouter.use(requireAuth);
offersRouter.get("/mine", asyncHandler(listMyOffersHandler));
offersRouter.get("/nearby", asyncHandler(getNearbyOffersHandler));
offersRouter.get("/:id", asyncHandler(getOfferHandler));
offersRouter.post("/", createOfferLimiter, asyncHandler(createOfferHandler));
offersRouter.patch("/:id", asyncHandler(updateOfferHandler));
offersRouter.post("/:id/end", asyncHandler(endOfferHandler));
offersRouter.post("/:id/view", asyncHandler(recordViewHandler));
offersRouter.post("/:id/directions", asyncHandler(recordDirectionsHandler));
offersRouter.post("/:id/call", asyncHandler(recordCallHandler));
