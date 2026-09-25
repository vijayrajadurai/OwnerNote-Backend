import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  getDailyCashOpening,
  getDailyCashReport,
  listDailyCashReports,
  submitDailyCashReport,
  upsertDailyCashOpening,
} from "./daily-cash.controller";

export const dailyCashRouter = Router();

dailyCashRouter.use(requireAuth);
dailyCashRouter.put("/openings", asyncHandler(upsertDailyCashOpening));
dailyCashRouter.get("/openings/:date", asyncHandler(getDailyCashOpening));
dailyCashRouter.get("/reports", asyncHandler(listDailyCashReports));
dailyCashRouter.get("/reports/:date", asyncHandler(getDailyCashReport));
dailyCashRouter.post("/reports", asyncHandler(submitDailyCashReport));
