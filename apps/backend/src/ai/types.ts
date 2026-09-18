export type TransactionIntent = "CREATE_CREDIT" | "CREATE_DEBIT" | "CASH_SALE" | "ASK_QUERY" | "UNKNOWN";

export interface ParsedTransaction {
  intent: TransactionIntent;
  /** Customer name for CREATE_CREDIT, supplier name for CREATE_DEBIT. */
  partyName: string | null;
  amount: number | null;
  currency: "INR";
  dueDate: string | null;
  description: string | null;
  confidence: number;
  rawText: string;
}

// ---- Phase 4: cash-flow, business health, insights ----

export interface CashFlowWindow {
  windowDays: number;
  expectedCollections: number;
  expectedPayments: number;
  /** max(0, expectedPayments - expectedCollections) — never negative. */
  potentialGap: number;
}

export interface CashFlowSummary {
  totalReceivables: number;
  totalPayables: number;
  pendingReceivables: number;
  pendingPayables: number;
  /** pendingReceivables - pendingPayables */
  netPosition: number;
  next7Days: CashFlowWindow;
  next30Days: CashFlowWindow;
  asOf: string;
}

export type BusinessHealthStatus = "STABLE" | "WATCH" | "PRESSURE" | "HIGH_PRESSURE";

export interface BusinessHealth {
  status: BusinessHealthStatus;
  explanation: string;
}

export type PriorityKind = "COLLECTION_DUE" | "PAYMENT_DUE" | "REMINDER" | "CASH_PRESSURE" | "ALL_CLEAR";
export type PrioritySeverity = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export interface PriorityItem {
  kind: PriorityKind;
  severity: PrioritySeverity;
  message: string;
  amount?: number;
  dueDate?: string;
  refId?: string;
}

export interface SeasonalEventDefinition {
  id: string;
  name: string;
  categories: string[] | "ALL";
  /** 1-12 */
  month: number;
  day: number;
  leadTimeDays: number;
  note: string;
}

export interface SeasonalInsightItem {
  eventId: string;
  eventName: string;
  eventDate: string;
  daysAway: number;
  note: string;
  estimate: {
    hasHistoricalBasis: boolean;
    message: string;
    lastYearAmount?: number;
  };
}

export interface HistoricalComparison {
  hasData: boolean;
  label: string;
  message: string;
  currentPeriodTotal?: number;
  previousPeriodTotal?: number;
  changePercent?: number;
  confidence: number;
}

export type BusinessPatternType =
  | "RECURRING_SUPPLIER"
  | "RECURRING_CUSTOMER"
  | "INCREASING_RECEIVABLES"
  | "INCREASING_PAYABLES"
  | "LARGE_PURCHASE_ANOMALY";

export interface BusinessPattern {
  type: BusinessPatternType;
  message: string;
  confidence: number;
  refId?: string;
  /** Raw magnitude behind the pattern (e.g. growth ratio) for callers needing a stricter threshold than the pattern's own detection floor. */
  value?: number;
}

export interface AiInsightCandidate {
  type:
    | "CASH_PRESSURE"
    | "PAYMENT_DUE"
    | "COLLECTION_DUE"
    | "BUSINESS_HEALTH"
    | "SEASONAL_PREPARATION"
    | "HISTORICAL_PATTERN"
    | "PURCHASE_PATTERN"
    | "UPCOMING_NEED";
  /** Stable identity for persistence upsert — must not change when only the display text changes (e.g. "due in 3 days" -> "due today"). */
  dedupeKey: string;
  title: string;
  description: string;
  severity: "INFO" | "WATCH" | "PRESSURE" | "HIGH_PRESSURE";
  confidence: number;
  sourceRefs?: Record<string, unknown>;
  validUntil?: string;
}

export interface AskAnswer {
  question: string;
  matchedIntent: string;
  answer: string;
  confidence: number;
}

// ---- Phase 5: funding opportunity detection & lead scoring ----

export type FundingOpportunityType =
  | "WORKING_CAPITAL"
  | "SEASONAL_STOCK"
  | "SUPPLIER_PAYMENT"
  | "LARGE_PURCHASE"
  | "EXPANSION"
  | "LARGE_ORDER"
  | "OTHER";

export type FundingUrgency = "LOW" | "MEDIUM" | "HIGH";

/** One explainable contributing factor behind a funding opportunity's signalScore. */
export interface FundingSignal {
  type: string;
  value: number;
  weight: number;
  source: string;
  confidence: number;
  description: string;
}

export interface FundingOpportunityCandidate {
  type: FundingOpportunityType;
  /** Stable identity for persistence upsert — see FundingOpportunity's doc comment in schema.prisma. */
  dedupeKey: string;
  title: string;
  explanation: string;
  estimatedRequirement: number | null;
  estimatedAvailableCash: number | null;
  estimatedGap: number | null;
  urgency: FundingUrgency;
  confidence: number;
  signalScore: number;
  sourceSignals: FundingSignal[];
  expiresAt?: string;
}

/** One explainable contributing factor behind a lead's 0-100 score. */
export interface LeadScoreSignal {
  label: string;
  points: number;
  reason: string;
}

export interface LeadScoreBreakdown {
  total: number;
  signals: LeadScoreSignal[];
}

export type UserIntent = "EXPLORE_OPTIONS" | "TALK_TO_SOMEONE";

/** What the owner actually types/picks on the qualification screen after choosing to explore. */
export interface LeadQualificationInput {
  workingCapitalRequirement?: number;
  fundingRequirementMin?: number;
  fundingRequirementMax?: number;
  preferredCallbackTime?: string;
  userIntent: UserIntent;
}
