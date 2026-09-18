import type { Request, Response } from "express";
import { z } from "zod";
import * as businessService from "../business/business.service";
import * as insightsService from "./insights.service";
import { getCashFlowSummary } from "../../ai/cashFlowAnalyzer";
import { computeBusinessHealth } from "../../ai/businessHealth";
import { getDailyPriorities } from "../../ai/dailyPriorities";
import { getSeasonalInsights } from "../../ai/seasonalIntelligence";
import { compareTrailingPeriods } from "../../ai/historicalIntelligence";
import { getQuestionAnswerer } from "../../ai/askMyBusiness";
import { UnauthorizedError } from "../../utils/errors";

async function requireBusinessId(req: Request): Promise<string> {
  if (!req.auth) throw new UnauthorizedError();
  const business = await businessService.getBusinessForUser(req.auth.userId);
  return business.id;
}

export async function getCashFlow(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const summary = await getCashFlowSummary(businessId);
  res.status(200).json({ data: summary });
}

export async function getBusinessHealth(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const summary = await getCashFlowSummary(businessId);
  const health = computeBusinessHealth(summary);
  res.status(200).json({ data: health });
}

export async function getPriorities(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const priorities = await getDailyPriorities(businessId);
  res.status(200).json({ data: priorities });
}

export async function getInsights(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const insights = await insightsService.refreshInsights(businessId);
  res.status(200).json({ data: insights });
}

export async function markInsightRead(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const insight = await insightsService.markInsightRead(businessId, req.params.id);
  res.status(200).json({ data: insight });
}

export async function dismissInsight(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const insight = await insightsService.dismissInsight(businessId, req.params.id);
  res.status(200).json({ data: insight });
}

export async function getSeasonal(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const seasonal = await getSeasonalInsights(businessId);
  res.status(200).json({ data: seasonal });
}

export async function getHistorical(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const comparison = await compareTrailingPeriods(businessId);
  res.status(200).json({ data: comparison });
}

const askSchema = z.object({ question: z.string().min(3).max(300) });

export async function askMyBusiness(req: Request, res: Response): Promise<void> {
  const businessId = await requireBusinessId(req);
  const { question } = askSchema.parse(req.body);
  const answer = await getQuestionAnswerer().answer(businessId, question);
  res.status(200).json({ data: answer });
}
