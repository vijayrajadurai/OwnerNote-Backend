import { Router } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../../config/env";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  cancelHandler,
  createRequestHandler,
  joinHandler,
  listMatchesHandler,
  listRequestsHandler,
} from "./groupBuying.controller";

const skipInTest = () => env.NODE_ENV === "test";

const createRequestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: { code: "RATE_LIMITED", message: "Too many group-buying requests. Try again shortly." } },
});

export const groupBuyingRouter = Router();

groupBuyingRouter.use(requireAuth);
groupBuyingRouter.post("/requests", createRequestLimiter, asyncHandler(createRequestHandler));
groupBuyingRouter.get("/requests", asyncHandler(listRequestsHandler));
groupBuyingRouter.get("/requests/:id/matches", asyncHandler(listMatchesHandler));
groupBuyingRouter.post("/requests/:id/join", asyncHandler(joinHandler));
groupBuyingRouter.post("/requests/:id/cancel", asyncHandler(cancelHandler));
