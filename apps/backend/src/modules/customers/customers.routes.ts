import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { listCustomers, getCustomer, createCustomer } from "./customers.controller";

export const customersRouter = Router();

customersRouter.use(requireAuth);
customersRouter.get("/", asyncHandler(listCustomers));
customersRouter.post("/", asyncHandler(createCustomer));
customersRouter.get("/:id", asyncHandler(getCustomer));
