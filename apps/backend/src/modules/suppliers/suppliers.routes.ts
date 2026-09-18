import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { listSuppliers, getSupplier, createSupplier } from "./suppliers.controller";

export const suppliersRouter = Router();

suppliersRouter.use(requireAuth);
suppliersRouter.get("/", asyncHandler(listSuppliers));
suppliersRouter.post("/", asyncHandler(createSupplier));
suppliersRouter.get("/:id", asyncHandler(getSupplier));
