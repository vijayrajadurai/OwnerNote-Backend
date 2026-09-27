import { describe, expect, it } from "vitest";
import { parseBillText } from "../src/ai/billParser";
import { parseOcrToTransaction } from "../src/modules/ocr/ocr.controller";

const GROCERY_BILL = [
  "SRI MURUGAN STORES",
  "12, Gandhi Road, Madurai",
  "Ph: 9876543210",
  "GSTIN: 33ABCDE1234F1Z5",
  "Bill No: 1045  Date: 12/09/2026",
  "Rice 5kg        2   450.00",
  "Oil 1L          1   180.00",
  "Sub Total           630.00",
  "CGST 2.5%            15.75",
  "SGST 2.5%            15.75",
  "Grand Total         661.50",
  "Thank you, visit again",
].join("\n");

describe("parseBillText", () => {
  it("takes the shop name from the header and the grand total, ignoring items, sub-total and tax", () => {
    const bill = parseBillText(GROCERY_BILL);
    expect(bill.shopName).toBe("Sri Murugan Stores");
    expect(bill.total).toBe(661.5);
    expect(bill.totalTier).toBe(1);
  });

  it("uses a plain Total line when there is no grand/net total", () => {
    const bill = parseBillText(["Kumar Hardwares", "Nails 1kg 120", "Paint 450", "TOTAL Rs 570"].join("\n"));
    expect(bill.shopName).toBe("Kumar Hardwares");
    expect(bill.total).toBe(570);
    expect(bill.totalTier).toBe(2);
  });

  it("reads comma-grouped amounts and a figure printed on the line below the label", () => {
    const bill = parseBillText(["Anand Traders", "Cement 50 bags", "Net Amount", "Rs 1,25,000.00"].join("\n"));
    expect(bill.total).toBe(125000);
  });

  it("ignores Total Qty / Total Items lines", () => {
    const bill = parseBillText(["Priya Mart", "Total Items: 14", "Total Qty 22", "Total 845.00"].join("\n"));
    expect(bill.total).toBe(845);
  });

  it("tolerates OCR zero-for-O in the TOTAL keyword", () => {
    expect(parseBillText("Ravi Stores\nT0TAL 300").total).toBe(300);
  });

  it("recognises the Tamil total word", () => {
    expect(parseBillText("முருகன் கடை\nஅரிசி 450\nமொத்தம் 450").total).toBe(450);
  });

  it("returns null instead of guessing when there is no total line", () => {
    const bill = parseBillText("Kumar Stores\nRice 450\nOil 180");
    expect(bill.total).toBeNull();
  });

  it("returns a null shop name when the header is only noise", () => {
    const bill = parseBillText("TAX INVOICE\nPh: 9876543210\nTotal 200");
    expect(bill.shopName).toBeNull();
    expect(bill.total).toBe(200);
  });
});

describe("parseOcrToTransaction", () => {
  it("turns a detected bill into a supplier debit entry with the shop and total", () => {
    const result = parseOcrToTransaction(GROCERY_BILL);
    expect(result.billDetected).toBe(true);
    expect(result.intent).toBe("CREATE_DEBIT");
    expect(result.partyName).toBe("Sri Murugan Stores");
    expect(result.amount).toBe(661.5);
    expect(result.description).toBe("Bill - Sri Murugan Stores");
    expect(result.dueDate).toBeNull();
  });

  it("falls back to the voice-style parser for non-bill notes", () => {
    const result = parseOcrToTransaction("Kumar-ku 2000 tharanum");
    expect(result.billDetected).toBe(false);
    expect(result.amount).toBe(2000);
  });
});
