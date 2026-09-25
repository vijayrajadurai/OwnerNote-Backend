import { Router } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../../config/env";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  addStockHandler,
  createProductHandler,
  deleteProductHandler,
  getIntelligenceSummaryHandler,
  getLowStockHandler,
  getProductHandler,
  getProductIntelligenceHandler,
  listMovementsHandler,
  listProductsHandler,
  removeStockHandler,
  updateProductHandler,
} from "./inventory.controller";

const skipInTest = () => env.NODE_ENV === "test";

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: { code: "RATE_LIMITED", message: "Too many inventory changes. Try again shortly." } },
});

export const inventoryRouter = Router();

inventoryRouter.use(requireAuth);
inventoryRouter.get("/products", asyncHandler(listProductsHandler));
inventoryRouter.get("/products/low-stock", asyncHandler(getLowStockHandler));
inventoryRouter.get("/products/:id", asyncHandler(getProductHandler));
inventoryRouter.post("/products", writeLimiter, asyncHandler(createProductHandler));
inventoryRouter.patch("/products/:id", writeLimiter, asyncHandler(updateProductHandler));
inventoryRouter.delete("/products/:id", writeLimiter, asyncHandler(deleteProductHandler));
inventoryRouter.post("/products/:id/stock-in", writeLimiter, asyncHandler(addStockHandler));
inventoryRouter.post("/products/:id/stock-out", writeLimiter, asyncHandler(removeStockHandler));
inventoryRouter.get("/products/:id/movements", asyncHandler(listMovementsHandler));
inventoryRouter.get("/products/:id/intelligence", asyncHandler(getProductIntelligenceHandler));
inventoryRouter.get("/intelligence/summary", asyncHandler(getIntelligenceSummaryHandler));
