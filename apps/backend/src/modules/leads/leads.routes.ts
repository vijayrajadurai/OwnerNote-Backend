import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import * as controller from "./leads.controller";

export const leadsRouter = Router();

// NOTE: leadsRouter, assignmentsRouter, and leadVisitsRouter are all
// mounted at the same "/leads" prefix in app.ts. Express Router.use()
// middleware without a path runs for every request that reaches that
// router — even one that ultimately matches a route in a *different*
// router mounted at the same prefix — so role checks must be attached
// per-route (not via a shared router.use()) to avoid one router's gate
// incorrectly blocking a request meant for another. requireAuth alone is
// safe as router-level middleware since every route here needs it regardless.
leadsRouter.use(requireAuth);

const readAccess = requireRole("ADMIN", "SALES_OFFICER");

leadsRouter.get("/", readAccess, asyncHandler(controller.listLeads));
// Must be registered before "/:id" so the literal path wins the match.
leadsRouter.get("/work-queue", readAccess, asyncHandler(controller.getWorkQueue));
leadsRouter.get("/fo-summary", readAccess, asyncHandler(controller.getFoSummary));
leadsRouter.get("/:id", readAccess, asyncHandler(controller.getLead));
leadsRouter.put("/:id/status", readAccess, asyncHandler(controller.updateLeadStatus));
