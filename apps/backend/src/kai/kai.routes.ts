import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { env } from "../config/env";
import * as controller from "./kai.controller";

// Per owner, not per IP: one shop's phone on a shared network never slows another shop down.
const kaiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.KAI_RATE_LIMIT_PER_MIN,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `kai:${req.auth?.userId ?? "anon"}`,
  skip: () => env.NODE_ENV === "test",
  message: { error: { code: "RATE_LIMITED", message: "Too many messages to Kai. Please wait a minute." } },
});

export const kaiRouter = Router();
kaiRouter.use(requireAuth);

kaiRouter.get("/status", asyncHandler(controller.getStatus));
kaiRouter.get("/feedback/export", requireRole("ADMIN"), asyncHandler(controller.exportFeedback));

const ownerOnly = requireRole("OWNER");
kaiRouter.post("/chat", ownerOnly, kaiLimiter, asyncHandler(controller.postChat));
kaiRouter.get("/conversations", ownerOnly, asyncHandler(controller.listConversations));
kaiRouter.get("/conversations/:id/messages", ownerOnly, asyncHandler(controller.listMessages));
kaiRouter.delete("/conversations/:id", ownerOnly, asyncHandler(controller.deleteConversation));
kaiRouter.post("/actions/:id/confirm", ownerOnly, kaiLimiter, asyncHandler(controller.confirmAction));
kaiRouter.post("/actions/:id/cancel", ownerOnly, asyncHandler(controller.cancelAction));
kaiRouter.get("/memories", ownerOnly, asyncHandler(controller.listMemories));
kaiRouter.delete("/memories/:id", ownerOnly, asyncHandler(controller.deleteMemory));
kaiRouter.post("/feedback", ownerOnly, asyncHandler(controller.postFeedback));
