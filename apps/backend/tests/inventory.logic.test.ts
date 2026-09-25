import { describe, expect, it } from "vitest";
import {
  analyzeInventoryProduct,
  buildInventoryIntelligenceSummary,
  canRemoveStock,
  computeStockStatus,
  findDuplicateProduct,
  type IntelligenceMovement,
  type IntelligenceProduct,
  type ProductIntelligence,
} from "../src/modules/inventory/inventory.logic";

const NOW = new Date("2026-09-25T12:00:00.000Z");

function product(overrides: Partial<IntelligenceProduct> = {}): IntelligenceProduct {
  return { id: "p1", name: "Cement", unit: "BAG", currentStock: 50, minimumStock: 20, ...overrides };
}

function outMovement(quantity: number, daysAgo: number): IntelligenceMovement {
  const createdAt = new Date(NOW);
  createdAt.setDate(createdAt.getDate() - daysAgo);
  return { type: "OUT", quantity, createdAt };
}

describe("computeStockStatus", () => {
  it("is LOW_STOCK at or below the minimum, HEALTHY above it", () => {
    expect(computeStockStatus(20, 20)).toBe("LOW_STOCK");
    expect(computeStockStatus(21, 20)).toBe("HEALTHY");
    expect(computeStockStatus(0, 0)).toBe("LOW_STOCK");
  });
});

describe("canRemoveStock", () => {
  it("allows removal up to and including the full current stock", () => {
    expect(canRemoveStock(50, 50)).toEqual({ ok: true });
    expect(canRemoveStock(50, 30)).toEqual({ ok: true });
  });

  it("never allows currentStock to go negative", () => {
    expect(canRemoveStock(50, 51)).toEqual({ ok: false, available: 50 });
  });
});

describe("findDuplicateProduct", () => {
  it("flags a case-insensitive, trimmed name match", () => {
    const existing = [{ id: "p1", name: "Cement" }];
    expect(findDuplicateProduct("  CEMENT  ", existing)?.id).toBe("p1");
  });

  it("never blocks a genuinely different name", () => {
    const existing = [{ id: "p1", name: "Cement" }];
    expect(findDuplicateProduct("Steel", existing)).toBeNull();
  });
});

describe("analyzeInventoryProduct — AI Stock Intelligence V1", () => {
  it("OUT_OF_STOCK at zero, regardless of minimumStock", () => {
    const result = analyzeInventoryProduct(product({ currentStock: 0 }), [], NOW);
    expect(result.status).toBe("OUT_OF_STOCK");
    expect(result.insights).toContain("OUT_OF_STOCK");
  });

  it("LOW_STOCK with INSUFFICIENT_HISTORY when there aren't enough real OUT records", () => {
    const result = analyzeInventoryProduct(product({ currentStock: 10, minimumStock: 20 }), [outMovement(5, 1)], NOW);
    expect(result.status).toBe("LOW_STOCK");
    expect(result.hasEnoughHistory).toBe(false);
    expect(result.averageDailyUsage).toBeNull();
    expect(result.estimatedDaysRemaining).toBeNull();
    expect(result.insights).toContain("INSUFFICIENT_HISTORY");
  });

  it("estimates real days remaining once there are enough real OUT records", () => {
    const movements = [outMovement(3, 1), outMovement(3, 5), outMovement(3, 10), outMovement(3, 20)];
    const result = analyzeInventoryProduct(product({ currentStock: 12, minimumStock: 20 }), movements, NOW);
    expect(result.hasEnoughHistory).toBe(true);
    expect(result.averageDailyUsage).toBeCloseTo(12 / 30);
    expect(result.estimatedDaysRemaining).toBe(Math.round(12 / (12 / 30)));
    expect(result.insights).toContain("ESTIMATED_LOW_COVER");
  });

  it("HEALTHY_STOCK when currentStock is above minimumStock", () => {
    const result = analyzeInventoryProduct(product({ currentStock: 100, minimumStock: 20 }), [], NOW);
    expect(result.status).toBe("HEALTHY_STOCK");
    expect(result.insights).toEqual(["HEALTHY_STOCK"]);
  });

  it("flags HIGH_USAGE only when recent 7-day usage clears the historical weekly average by the fixed multiplier", () => {
    const historicalOnly = [outMovement(1, 10), outMovement(1, 15), outMovement(1, 20)]; // steady low usage
    const recentSpike = [outMovement(10, 1), outMovement(10, 2), outMovement(1, 20), outMovement(1, 25), outMovement(1, 29)];
    const steady = analyzeInventoryProduct(product({ currentStock: 100 }), historicalOnly, NOW);
    const spiking = analyzeInventoryProduct(product({ currentStock: 100 }), recentSpike, NOW);
    expect(steady.isHighUsage).toBe(false);
    expect(spiking.isHighUsage).toBe(true);
    expect(spiking.insights).toContain("HIGH_USAGE");
  });

  it("never counts IN/ADJUSTMENT movements or future-dated rows as usage", () => {
    const future = new Date(NOW);
    future.setDate(future.getDate() + 5);
    const movements: IntelligenceMovement[] = [
      { type: "IN", quantity: 999, createdAt: new Date(NOW) },
      { type: "ADJUSTMENT", quantity: 999, createdAt: new Date(NOW) },
      { type: "OUT", quantity: 999, createdAt: future },
    ];
    const result = analyzeInventoryProduct(product(), movements, NOW);
    expect(result.usage7Days).toBe(0);
    expect(result.usage30Days).toBe(0);
  });
});

describe("buildInventoryIntelligenceSummary", () => {
  function analysis(overrides: Partial<ProductIntelligence>): ProductIntelligence {
    return {
      productId: "p1",
      productName: "Cement",
      currentStock: 50,
      minimumStock: 20,
      unit: "BAG",
      status: "HEALTHY_STOCK",
      usage7Days: 0,
      usage30Days: 0,
      averageDailyUsage: null,
      estimatedDaysRemaining: null,
      hasEnoughHistory: false,
      isHighUsage: false,
      insights: ["HEALTHY_STOCK"],
      ...overrides,
    };
  }

  it("ranks OUT_OF_STOCK, then LOW_STOCK, then HIGH_USAGE — never healthy products", () => {
    const outOfStock = analysis({ productId: "out", status: "OUT_OF_STOCK", insights: ["OUT_OF_STOCK"] });
    const lowStock = analysis({ productId: "low", status: "LOW_STOCK", insights: ["LOW_STOCK"] });
    const highUsage = analysis({ productId: "high", isHighUsage: true, insights: ["HEALTHY_STOCK", "HIGH_USAGE"], usage7Days: 50 });
    const healthy = analysis({ productId: "healthy" });

    const summary = buildInventoryIntelligenceSummary([healthy, highUsage, lowStock, outOfStock]);
    expect(summary.attentionProducts.map((a) => a.productId)).toEqual(["out", "low", "high"]);
    expect(summary.totalProducts).toBe(4);
    expect(summary.outOfStockCount).toBe(1);
    expect(summary.lowStockCount).toBe(1);
    expect(summary.healthyCount).toBe(2);
  });

  it("never fabricates a count beyond the real analyses passed in", () => {
    const summary = buildInventoryIntelligenceSummary([]);
    expect(summary.totalProducts).toBe(0);
    expect(summary.attentionProducts).toHaveLength(0);
  });
});
