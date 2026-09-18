import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { getMyBusiness, putMyBusiness } from "./business.controller";

export const businessRouter = Router();

businessRouter.use(requireAuth);
businessRouter.get("/", asyncHandler(getMyBusiness));
businessRouter.put("/", asyncHandler(putMyBusiness));
