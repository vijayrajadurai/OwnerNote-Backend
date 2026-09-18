import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import * as controller from "./discover.controller";

export const discoverRouter = Router();
discoverRouter.use(requireAuth);
discoverRouter.get("/", asyncHandler(controller.getDiscoverFeed));
discoverRouter.post("/", asyncHandler(controller.createDiscoverItem));
discoverRouter.put("/:id", asyncHandler(controller.updateDiscoverItem));
discoverRouter.delete("/:id", asyncHandler(controller.deleteDiscoverItem));

export const adminDiscoverRouter = Router();
adminDiscoverRouter.use(requireAuth, requireRole("ADMIN"));
adminDiscoverRouter.get("/businesses", asyncHandler(controller.adminListBusinesses));
adminDiscoverRouter.get("/", asyncHandler(controller.adminListDiscover));
adminDiscoverRouter.post("/", asyncHandler(controller.adminCreateDiscover));
adminDiscoverRouter.put("/:id", asyncHandler(controller.adminUpdateDiscover));
adminDiscoverRouter.delete("/:id", asyncHandler(controller.adminDeleteDiscover));
