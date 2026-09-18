import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { getDashboard } from "./dashboard.controller";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);
dashboardRouter.get("/", asyncHandler(getDashboard));
