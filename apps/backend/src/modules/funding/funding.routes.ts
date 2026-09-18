import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import * as controller from "./funding.controller";

export const fundingOpportunitiesRouter = Router();
fundingOpportunitiesRouter.use(requireAuth);
fundingOpportunitiesRouter.get("/", asyncHandler(controller.listOpportunities));
fundingOpportunitiesRouter.get("/:id", asyncHandler(controller.getOpportunity));
fundingOpportunitiesRouter.post("/:id/interested", asyncHandler(controller.markInterested));
fundingOpportunitiesRouter.post("/:id/not-now", asyncHandler(controller.markNotNow));
fundingOpportunitiesRouter.post("/:id/create-lead", asyncHandler(controller.createLead));

export const loanLeadsRouter = Router();
loanLeadsRouter.use(requireAuth);
loanLeadsRouter.get("/", asyncHandler(controller.listMyLeads));
