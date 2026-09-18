import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import * as controller from "./assignments.controller";

// Mounted at /leads alongside leadsRouter and leadVisitsRouter — see the
// note in leads.routes.ts about why role checks live per-route here
// rather than on a shared router.use().
export const assignmentsRouter = Router();
assignmentsRouter.use(requireAuth);

const adminOnly = requireRole("ADMIN");

assignmentsRouter.post("/:id/assign", adminOnly, asyncHandler(controller.assignLead));
assignmentsRouter.post("/:id/unassign", adminOnly, asyncHandler(controller.unassignLead));
assignmentsRouter.get("/:id/assignments", adminOnly, asyncHandler(controller.getAssignmentHistory));
