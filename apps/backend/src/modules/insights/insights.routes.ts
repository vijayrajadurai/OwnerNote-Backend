import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import * as controller from "./insights.controller";

export const cashFlowRouter = Router();
cashFlowRouter.use(requireAuth);
cashFlowRouter.get("/", asyncHandler(controller.getCashFlow));

export const businessHealthRouter = Router();
businessHealthRouter.use(requireAuth);
businessHealthRouter.get("/", asyncHandler(controller.getBusinessHealth));

export const prioritiesRouter = Router();
prioritiesRouter.use(requireAuth);
prioritiesRouter.get("/", asyncHandler(controller.getPriorities));

export const aiInsightsRouter = Router();
aiInsightsRouter.use(requireAuth);
aiInsightsRouter.get("/", asyncHandler(controller.getInsights));
aiInsightsRouter.post("/:id/read", asyncHandler(controller.markInsightRead));
aiInsightsRouter.post("/:id/dismiss", asyncHandler(controller.dismissInsight));

export const seasonalInsightsRouter = Router();
seasonalInsightsRouter.use(requireAuth);
seasonalInsightsRouter.get("/", asyncHandler(controller.getSeasonal));

export const historicalInsightsRouter = Router();
historicalInsightsRouter.use(requireAuth);
historicalInsightsRouter.get("/", asyncHandler(controller.getHistorical));

export const askMyBusinessRouter = Router();
askMyBusinessRouter.use(requireAuth);
askMyBusinessRouter.post("/", asyncHandler(controller.askMyBusiness));
