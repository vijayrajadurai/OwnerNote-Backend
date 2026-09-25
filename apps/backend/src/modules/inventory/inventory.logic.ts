/**
 * Faithful port of the Owner Note Inventory + AI Stock Intelligence pure
 * logic.
 *
 * Original (mobile): apps/mobile/src/storage/localAi/inventory.ts and
 * apps/mobile/src/storage/localAi/inventoryIntelligence.ts. Keep this file
 * in lockstep with those sources — same rules, no LLM, no invented
 * numbers. Only the row type differs (Prisma-backed rows here instead of
 * SQLite rows there).
 *
 * currentStock/minimumStock are physical quantities only, never currency —
 * nothing here reads or writes CreditTransaction/DebitTransaction, and
 * nothing in that domain reads or writes InventoryProduct/InventoryMovement.
 */

export type StockStatus = "LOW_STOCK" | "HEALTHY";

// No predictive AI — a plain threshold comparison.
export function computeStockStatus(currentStock: number, minimumStock: number): StockStatus {
  return currentStock <= minimumStock ? "LOW_STOCK" : "HEALTHY";
}

export type StockRemovalDecision = { ok: true } | { ok: false; available: number };

/** The one place "can this much stock be removed" is decided. Never allows
 * currentStock to go negative — the caller must not write to the DB when
 * this returns ok:false. */
export function canRemoveStock(currentStock: number, quantity: number): StockRemovalDecision {
  if (quantity > currentStock) return { ok: false, available: currentStock };
  return { ok: true };
}

function normalizeProductName(name: string): string {
  return name.trim().toLowerCase();
}

export interface DuplicateCheckProduct {
  id: string;
  name: string;
}

/** Same-business, case-insensitive, trimmed name match is treated as "you
 * already have this product," never silently duplicated. A genuinely
 * different product name is never blocked. */
export function findDuplicateProduct<T extends DuplicateCheckProduct>(name: string, existingProducts: T[]): T | null {
  const target = normalizeProductName(name);
  return existingProducts.find((p) => normalizeProductName(p.name) === target) ?? null;
}

// ---------------------------------------------------------------------
// AI Stock Intelligence (V1) — pure, deterministic, read-only analysis
// over real InventoryMovement rows. No LLM: every number is a plain
// arithmetic aggregate over real OUT movements, every sentence a fixed
// template filled from that real data — never an invented estimate,
// never a guaranteed prediction.
// ---------------------------------------------------------------------

const MIN_OUT_RECORDS_FOR_HISTORY = 3;
const USAGE_WINDOW_7_DAYS = 7;
const USAGE_WINDOW_30_DAYS = 30;
const HIGH_USAGE_MULTIPLIER = 1.5;
const MAX_TOP_USAGE_PRODUCTS = 5;

export type StockIntelligenceStatus = "OUT_OF_STOCK" | "LOW_STOCK" | "HEALTHY_STOCK";
export type InsightType = "OUT_OF_STOCK" | "LOW_STOCK" | "HEALTHY_STOCK" | "HIGH_USAGE" | "ESTIMATED_LOW_COVER" | "INSUFFICIENT_HISTORY";

export interface IntelligenceProduct {
  id: string;
  name: string;
  unit: string;
  currentStock: number;
  minimumStock: number;
}

export interface IntelligenceMovement {
  type: "IN" | "OUT" | "ADJUSTMENT";
  quantity: number;
  createdAt: Date;
}

export interface ProductIntelligence {
  productId: string;
  productName: string;
  currentStock: number;
  minimumStock: number;
  unit: string;
  status: StockIntelligenceStatus;
  usage7Days: number;
  usage30Days: number;
  averageDailyUsage: number | null;
  estimatedDaysRemaining: number | null;
  hasEnoughHistory: boolean;
  isHighUsage: boolean;
  insights: InsightType[];
}

function computeIntelligenceStatus(currentStock: number, minimumStock: number): StockIntelligenceStatus {
  if (currentStock === 0) return "OUT_OF_STOCK";
  if (currentStock <= minimumStock) return "LOW_STOCK";
  return "HEALTHY_STOCK";
}

interface OutTotal {
  total: number;
  count: number;
}

function sumOutMovements(movements: IntelligenceMovement[], since: Date, now: Date): OutTotal {
  let total = 0;
  let count = 0;
  for (const m of movements) {
    if (m.type !== "OUT") continue;
    const t = m.createdAt.getTime();
    if (t > now.getTime()) continue;
    if (t < since.getTime()) continue;
    total += m.quantity;
    count += 1;
  }
  return { total, count };
}

function daysAgo(now: Date, days: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d;
}

/** The one per-product analysis function. `movements` may be full history
 * (IN/OUT/ADJUSTMENT) or a pre-filtered OUT-only subset — the result is
 * identical either way, since this does its own type/date filtering
 * regardless of what it's handed. */
export function analyzeInventoryProduct(product: IntelligenceProduct, movements: IntelligenceMovement[], now: Date): ProductIntelligence {
  const out7 = sumOutMovements(movements, daysAgo(now, USAGE_WINDOW_7_DAYS), now);
  const out30 = sumOutMovements(movements, daysAgo(now, USAGE_WINDOW_30_DAYS), now);

  const status = computeIntelligenceStatus(product.currentStock, product.minimumStock);
  const hasEnoughHistory = out30.count >= MIN_OUT_RECORDS_FOR_HISTORY;
  const averageDailyUsage = hasEnoughHistory ? out30.total / USAGE_WINDOW_30_DAYS : null;
  const estimatedDaysRemaining =
    hasEnoughHistory && averageDailyUsage !== null && averageDailyUsage > 0 && product.currentStock > 0 ? Math.round(product.currentStock / averageDailyUsage) : null;

  const historicalWeeklyAverage = hasEnoughHistory && averageDailyUsage !== null ? averageDailyUsage * 7 : null;
  const isHighUsage = hasEnoughHistory && historicalWeeklyAverage !== null && historicalWeeklyAverage > 0 && out7.total > historicalWeeklyAverage * HIGH_USAGE_MULTIPLIER;

  const insights: InsightType[] = [];
  if (status === "OUT_OF_STOCK") {
    insights.push("OUT_OF_STOCK");
  } else if (status === "LOW_STOCK") {
    insights.push("LOW_STOCK");
    if (hasEnoughHistory && estimatedDaysRemaining !== null) insights.push("ESTIMATED_LOW_COVER");
    else if (!hasEnoughHistory) insights.push("INSUFFICIENT_HISTORY");
  } else {
    insights.push("HEALTHY_STOCK");
  }
  if (isHighUsage) insights.push("HIGH_USAGE");

  return {
    productId: product.id,
    productName: product.name,
    currentStock: product.currentStock,
    minimumStock: product.minimumStock,
    unit: product.unit,
    status,
    usage7Days: out7.total,
    usage30Days: out30.total,
    averageDailyUsage,
    estimatedDaysRemaining,
    hasEnoughHistory,
    isHighUsage,
    insights,
  };
}

export interface InventoryIntelligenceSummary {
  totalProducts: number;
  lowStockCount: number;
  outOfStockCount: number;
  healthyCount: number;
  attentionProducts: ProductIntelligence[];
  topUsageProducts: ProductIntelligence[];
  insights: InsightType[];
}

function attentionRank(p: ProductIntelligence): number {
  if (p.status === "OUT_OF_STOCK") return 0;
  if (p.status === "LOW_STOCK") return 1;
  if (p.isHighUsage) return 2;
  return 99;
}

export function buildInventoryIntelligenceSummary(analyses: ProductIntelligence[]): InventoryIntelligenceSummary {
  const outOfStockCount = analyses.filter((a) => a.status === "OUT_OF_STOCK").length;
  const lowStockCount = analyses.filter((a) => a.status === "LOW_STOCK").length;
  const healthyCount = analyses.filter((a) => a.status === "HEALTHY_STOCK").length;

  const attentionProducts = analyses.filter((a) => attentionRank(a) < 99).sort((a, b) => attentionRank(a) - attentionRank(b));

  const topUsageProducts = analyses
    .filter((a) => a.isHighUsage)
    .sort((a, b) => b.usage7Days - a.usage7Days)
    .slice(0, MAX_TOP_USAGE_PRODUCTS);

  const insights = Array.from(new Set(analyses.flatMap((a) => a.insights))).filter((i) => i !== "HEALTHY_STOCK");

  return {
    totalProducts: analyses.length,
    lowStockCount,
    outOfStockCount,
    healthyCount,
    attentionProducts,
    topUsageProducts,
    insights,
  };
}
