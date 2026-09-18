import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import * as controller from "./visits.controller";

// Mounted at /leads alongside leadsRouter and assignmentsRouter — see the
// note in leads.routes.ts about why role checks live per-route here
// rather than on a shared router.use().
export const leadVisitsRouter = Router();
leadVisitsRouter.use(requireAuth);

const readAccess = requireRole("ADMIN", "SALES_OFFICER");
const officerOnly = requireRole("SALES_OFFICER");

leadVisitsRouter.get("/:leadId/visits", readAccess, asyncHandler(controller.listVisitsForLead));
leadVisitsRouter.post("/:leadId/visits", officerOnly, asyncHandler(controller.createVisit));

// Mounted at /visits.
export const visitsRouter = Router();
visitsRouter.use(requireAuth);
visitsRouter.get("/follow-ups", readAccess, asyncHandler(controller.listUpcomingFollowUps));
visitsRouter.get("/:id", readAccess, asyncHandler(controller.getVisit));
visitsRouter.put("/:id", officerOnly, asyncHandler(controller.updateVisit));
