import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { env } from "./config/env";
import { logger } from "./utils/logger";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { authRouter } from "./modules/auth/auth.routes";
import { businessRouter } from "./modules/business/business.routes";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes";
import { customersRouter } from "./modules/customers/customers.routes";
import { suppliersRouter } from "./modules/suppliers/suppliers.routes";
import { transactionsRouter } from "./modules/transactions/transactions.routes";
import { remindersRouter } from "./modules/reminders/reminders.routes";
import { voiceRouter } from "./modules/voice/voice.routes";
import { ocrRouter } from "./modules/ocr/ocr.routes";
import {
  cashFlowRouter,
  businessHealthRouter,
  prioritiesRouter,
  aiInsightsRouter,
  seasonalInsightsRouter,
  historicalInsightsRouter,
  askMyBusinessRouter,
} from "./modules/insights/insights.routes";
import { fundingOpportunitiesRouter, loanLeadsRouter } from "./modules/funding/funding.routes";
import { leadsRouter } from "./modules/leads/leads.routes";
import { assignmentsRouter } from "./modules/assignments/assignments.routes";
import { leadVisitsRouter, visitsRouter } from "./modules/visits/visits.routes";
import { adminRouter } from "./modules/admin/admin.routes";
import { adminDiscoverRouter, discoverRouter } from "./modules/discover/discover.routes";
import { dailyCashRouter } from "./modules/daily-cash/daily-cash.routes";

// Bearer tokens and cookies must never reach application logs. Exported so
// tests can exercise this exact configuration against a real pino-http
// middleware instance, not just assert on its shape.
export const REQUEST_LOG_REDACT_CONFIG = {
  paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
  censor: "[Redacted]",
};

export function createApp(): Express {
  const app = express();

  // Must be set before any middleware that reads req.ip (notably the rate
  // limiter below) so it sees the correctly-resolved client address rather
  // than the raw socket address of whatever reverse proxy sits in front of
  // this server. env.TRUST_PROXY defaults to `false` (Express's own
  // default — no proxy trust), so this is a no-op until a real deployment
  // topology sets TRUST_PROXY to the actual number of proxy hops.
  app.set("trust proxy", env.TRUST_PROXY);

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",") }));
  app.use(express.json());
  app.use(
    pinoHttp({
      logger,
      autoLogging: env.NODE_ENV !== "test",
      redact: REQUEST_LOG_REDACT_CONFIG,
    }),
  );

  // Global rate limit as defense-in-depth on top of per-route limiters.
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 600,
      standardHeaders: true,
      legacyHeaders: false,
      skip: () => env.NODE_ENV === "test",
    }),
  );

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use("/auth", authRouter);
  app.use("/business", businessRouter);
  app.use("/dashboard", dashboardRouter);
  app.use("/customers", customersRouter);
  app.use("/suppliers", suppliersRouter);
  app.use("/transactions", transactionsRouter);
  app.use("/reminders", remindersRouter);
  app.use("/voice", voiceRouter);
  app.use("/ocr", ocrRouter);
  app.use("/cashflow", cashFlowRouter);
  app.use("/business-health", businessHealthRouter);
  app.use("/priorities", prioritiesRouter);
  app.use("/ai-insights", aiInsightsRouter);
  app.use("/seasonal-insights", seasonalInsightsRouter);
  app.use("/historical-insights", historicalInsightsRouter);
  app.use("/ask-my-business", askMyBusinessRouter);
  app.use("/discover", discoverRouter);
  app.use("/daily-cash", dailyCashRouter);
  app.use("/admin/discover", adminDiscoverRouter);
  app.use("/funding-opportunities", fundingOpportunitiesRouter);
  app.use("/loan-leads", loanLeadsRouter);
  app.use("/leads", leadsRouter);
  app.use("/leads", assignmentsRouter);
  app.use("/leads", leadVisitsRouter);
  app.use("/visits", visitsRouter);
  app.use("/admin", adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
