import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { registerDevice, unregisterDevice } from "./devices.controller";

export const devicesRouter = Router();

devicesRouter.use(requireAuth);
devicesRouter.post("/fcm", asyncHandler(registerDevice));
devicesRouter.post("/fcm/unregister", asyncHandler(unregisterDevice));
