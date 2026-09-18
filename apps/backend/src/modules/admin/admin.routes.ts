import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import * as controller from "./admin.controller";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole("ADMIN"));
adminRouter.get("/sales-officers", asyncHandler(controller.listSalesOfficers));
adminRouter.post("/sales-officers", asyncHandler(controller.createSalesOfficer));
adminRouter.get("/sales-officers/:id/performance", asyncHandler(controller.getSalesOfficerPerformance));
adminRouter.get("/sales-officers-performance", asyncHandler(controller.listAllSalesOfficerPerformance));
adminRouter.get("/analytics", asyncHandler(controller.getPipelineAnalytics));
adminRouter.get("/audit-log", asyncHandler(controller.listAuditLog));
