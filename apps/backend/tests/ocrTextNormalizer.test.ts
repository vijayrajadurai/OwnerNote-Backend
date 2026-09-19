import { describe, expect, it } from "vitest";
import { normalizeOcrText } from "../src/ai/ocrTextNormalizer";

describe("normalizeOcrText", () => {
  it("fixes common digit OCR mistakes", () => {
    expect(normalizeOcrText("Kumar Rs 2o00 due")).toBe("Kumar Rs 2000 due");
  });

  it("collapses extra whitespace and blank lines", () => {
    expect(normalizeOcrText("  Kumar   \n\n  2000  ")).toBe("Kumar\n2000");
  });

  it("normalizes rupee symbol", () => {
    expect(normalizeOcrText("Total ₹1500")).toBe("Total Rs 1500");
  });
});
