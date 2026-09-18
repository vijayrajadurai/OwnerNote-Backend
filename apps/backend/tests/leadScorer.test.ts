import { describe, expect, it } from "vitest";
import { scoreLead } from "../src/ai/leadScorer";

describe("scoreLead", () => {
  it("scores low intent conservatively with minimal qualification data", () => {
    const result = scoreLead({
      opportunity: { urgency: "LOW", signalScore: 40 },
      qualification: { userIntent: "EXPLORE_OPTIONS" },
      businessDurationYears: null,
      recentTransactionCount: 2,
    });
    // 40*0.4=16 + urgency 0 + intent 10 + callback 0 + requirement 0 + duration 0 + activity 0 = 26
    expect(result.total).toBe(26);
    expect(result.total).toBeLessThan(50);
  });

  it("scores medium intent with a stated requirement and moderate urgency", () => {
    const result = scoreLead({
      opportunity: { urgency: "MEDIUM", signalScore: 60 },
      qualification: { userIntent: "EXPLORE_OPTIONS", fundingRequirementMax: 200000 },
      businessDurationYears: 2,
      recentTransactionCount: 6,
    });
    // 60*0.4=24 + urgency 5 + intent 10 + callback 0 + requirement 10 + duration 5 + activity 3 = 57
    expect(result.total).toBe(57);
    expect(result.total).toBeGreaterThanOrEqual(50);
    expect(result.total).toBeLessThan(70);
  });

  it("scores high intent with full qualification data and high urgency", () => {
    const result = scoreLead({
      opportunity: { urgency: "HIGH", signalScore: 90 },
      qualification: {
        userIntent: "TALK_TO_SOMEONE",
        fundingRequirementMax: 500000,
        preferredCallbackTime: "4 PM",
      },
      businessDurationYears: 5,
      recentTransactionCount: 15,
    });
    // 90*0.4=36 + urgency 10 + intent 20 + callback 10 + requirement 10 + duration 10 + activity 5 = 101 -> capped 100
    expect(result.total).toBe(100);
  });

  it("always returns an explanation entry per contributing factor", () => {
    const result = scoreLead({
      opportunity: { urgency: "HIGH", signalScore: 80 },
      qualification: { userIntent: "TALK_TO_SOMEONE", preferredCallbackTime: "10 AM" },
      businessDurationYears: 3,
      recentTransactionCount: 8,
    });
    const labels = result.signals.map((s) => s.label);
    expect(labels).toEqual([
      "Business situation strength",
      "Urgency",
      "User intent",
      "Callback requested",
      "Stated funding requirement",
      "Business duration",
      "Recent business activity",
    ]);
    expect(result.signals.reduce((sum, s) => sum + s.points, 0)).toBe(result.total);
  });

  it("never uses sensitive personal attributes — only opportunity, qualification, duration, and activity", () => {
    const result = scoreLead({
      opportunity: { urgency: "LOW", signalScore: 40 },
      qualification: { userIntent: "EXPLORE_OPTIONS" },
      businessDurationYears: 0,
      recentTransactionCount: 0,
    });
    const reasonsText = result.signals.map((s) => s.reason).join(" ");
    expect(reasonsText).not.toMatch(/caste|religion|gender|age\b/i);
  });
});
