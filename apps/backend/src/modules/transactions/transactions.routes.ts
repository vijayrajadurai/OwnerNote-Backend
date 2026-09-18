import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import * as controller from "./transactions.controller";

export const transactionsRouter = Router();

transactionsRouter.use(requireAuth);

transactionsRouter.get("/", asyncHandler(controller.listAllHandler));

transactionsRouter.post("/credit", asyncHandler(controller.createCreditHandler));
transactionsRouter.get("/credit", asyncHandler(controller.listCreditHandler));
transactionsRouter.get("/credit/:id", asyncHandler(controller.getCreditHandler));
transactionsRouter.put("/credit/:id", asyncHandler(controller.updateCreditHandler));
transactionsRouter.delete("/credit/:id", asyncHandler(controller.deleteCreditHandler));
transactionsRouter.post("/credit/:id/payments", asyncHandler(controller.addCreditPaymentHandler));
transactionsRouter.post("/credit/:id/mark-paid", asyncHandler(controller.markCreditPaidHandler));

transactionsRouter.post("/debit", asyncHandler(controller.createDebitHandler));
transactionsRouter.get("/debit", asyncHandler(controller.listDebitHandler));
transactionsRouter.get("/debit/:id", asyncHandler(controller.getDebitHandler));
transactionsRouter.put("/debit/:id", asyncHandler(controller.updateDebitHandler));
transactionsRouter.delete("/debit/:id", asyncHandler(controller.deleteDebitHandler));
transactionsRouter.post("/debit/:id/payments", asyncHandler(controller.addDebitPaymentHandler));
transactionsRouter.post("/debit/:id/mark-paid", asyncHandler(controller.markDebitPaidHandler));
