import { describe, expect, it } from "vitest";
import { computeBusinessHealth } from "../src/ai/businessHealth";
import type { CashFlowSummary } from "../src/ai/types";

function summary(overrides: Partial<CashFlowSummary> = {}): CashFlowSummary {
  return {
    totalReceivables: 0,
    totalPayables: 0,
    pendingReceivables: 0,
    pendingPayables: 0,
    netPosition: 0,
    next7Days: { windowDays: 7, expectedCollections: 0, expectedPayments: 0, potentialGap: 0 },
    next30Days: { windowDays: 30, expectedCollections: 0, expectedPayments: 0, potentialGap: 0 },
    asOf: new Date().toISOString(),
    ...overrides,
  };
}

describe("computeBusinessHealth", () => {
  it("is STABLE with an explanation when there is no pending activity at all", () => {
    const health = computeBusinessHealth(summary());
    expect(health.status).toBe("STABLE");
    expect(health.explanation).toMatch(/no pending/i);
  });

  it("is STABLE when expected collections cover expected payments", () => {
    const health = computeBusinessHealth(
      summary({
        pendingReceivables: 50000,
        pendingPayables: 30000,
        next7Days: { windowDays: 7, expectedCollections: 40000, expectedPayments: 20000, potentialGap: 0 },
      }),
    );
    expect(health.status).toBe("STABLE");
  });

  it("is WATCH for a small gap relative to expected payments", () => {
    const health = computeBusinessHealth(
      summary({
        pendingPayables: 100000,
        next7Days: { windowDays: 7, expectedCollections: 90000, expectedPayments: 100000, potentialGap: 10000 },
      }),
    );
    expect(health.status).toBe("WATCH");
  });

  it("is PRESSURE for a moderate gap", () => {
    const health = computeBusinessHealth(
      summary({
        pendingPayables: 100000,
        next7Days: { windowDays: 7, expectedCollections: 40000, expectedPayments: 100000, potentialGap: 60000 },
      }),
    );
    expect(health.status).toBe("PRESSURE");
    expect(health.explanation).toContain("60,000");
  });

  it("is HIGH_PRESSURE for a large gap relative to expected payments", () => {
    const health = computeBusinessHealth(
      summary({
        pendingPayables: 100000,
        next7Days: { windowDays: 7, expectedCollections: 5000, expectedPayments: 100000, potentialGap: 95000 },
      }),
    );
    expect(health.status).toBe("HIGH_PRESSURE");
  });

  it("explanation always references the actual figures passed in", () => {
    const health = computeBusinessHealth(
      summary({
        pendingPayables: 120000,
        next7Days: { windowDays: 7, expectedCollections: 60000, expectedPayments: 120000, potentialGap: 60000 },
      }),
    );
    expect(health.explanation).toContain("60,000");
    expect(health.explanation).toContain("1,20,000");
  });
});
