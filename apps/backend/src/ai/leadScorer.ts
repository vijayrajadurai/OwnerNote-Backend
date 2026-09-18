import type { FundingOpportunityCandidate, LeadQualificationInput, LeadScoreBreakdown } from "./types";

/**
 * Pure function (no DB access): scores a lead 0-100 from the funding
 * opportunity that prompted it plus what the owner actually told us on the
 * qualification screen. No sensitive personal attributes are used —
 * business duration and recorded transaction activity are the only
 * "business profile" inputs, both already collected for the product
 * itself, not gathered for scoring purposes.
 */
export interface LeadScoringInput {
  opportunity: Pick<FundingOpportunityCandidate, "urgency" | "signalScore">;
  qualification: LeadQualificationInput;
  businessDurationYears: number | null;
  recentTransactionCount: number;
}

export function scoreLead(input: LeadScoringInput): LeadScoreBreakdown {
  const signals: LeadScoreBreakdown["signals"] = [];

  const situationPoints = Math.round(input.opportunity.signalScore * 0.4);
  signals.push({
    label: "Business situation strength",
    points: situationPoints,
    reason: `Derived from the underlying funding opportunity's signal score (${input.opportunity.signalScore}/100).`,
  });

  const urgencyPoints = input.opportunity.urgency === "HIGH" ? 10 : input.opportunity.urgency === "MEDIUM" ? 5 : 0;
  signals.push({
    label: "Urgency",
    points: urgencyPoints,
    reason: `Opportunity urgency is ${input.opportunity.urgency}.`,
  });

  const intentPoints = input.qualification.userIntent === "TALK_TO_SOMEONE" ? 20 : 10;
  signals.push({
    label: "User intent",
    points: intentPoints,
    reason:
      input.qualification.userIntent === "TALK_TO_SOMEONE"
        ? "Owner explicitly asked to talk to someone."
        : "Owner chose to explore funding options.",
  });

  const callbackPoints = input.qualification.preferredCallbackTime ? 10 : 0;
  signals.push({
    label: "Callback requested",
    points: callbackPoints,
    reason: callbackPoints > 0 ? "Owner provided a preferred callback time." : "No callback time provided.",
  });

  const hasRequirement =
    (input.qualification.fundingRequirementMax ?? 0) > 0 || (input.qualification.workingCapitalRequirement ?? 0) > 0;
  const requirementPoints = hasRequirement ? 10 : 0;
  signals.push({
    label: "Stated funding requirement",
    points: requirementPoints,
    reason: hasRequirement ? "Owner specified a funding/working-capital amount." : "No specific amount provided.",
  });

  const durationYears = input.businessDurationYears ?? 0;
  const durationPoints = durationYears >= 3 ? 10 : durationYears >= 1 ? 5 : 0;
  signals.push({
    label: "Business duration",
    points: durationPoints,
    reason: `Business has been running for approximately ${durationYears} year(s).`,
  });

  const activityPoints = input.recentTransactionCount >= 10 ? 5 : input.recentTransactionCount >= 5 ? 3 : 0;
  signals.push({
    label: "Recent business activity",
    points: activityPoints,
    reason: `${input.recentTransactionCount} transaction(s) recorded in the last 60 days.`,
  });

  const total = Math.min(100, signals.reduce((sum, s) => sum + s.points, 0));

  return { total, signals };
}
