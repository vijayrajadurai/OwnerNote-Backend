import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  getDailyCashReport,
  listDailyCashReports,
  submitDailyCashReport,
} from "./daily-cash.controller";

export const dailyCashRouter = Router();

dailyCashRouter.use(requireAuth);
dailyCashRouter.get("/reports", asyncHandler(listDailyCashReports));
dailyCashRouter.get("/reports/:date", asyncHandler(getDailyCashReport));
dailyCashRouter.post("/reports", asyncHandler(submitDailyCashReport));
