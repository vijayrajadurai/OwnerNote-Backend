import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { authenticate, setUpBusiness } from "./testHelpers";

const app = createApp();
const phone = "+919876500099";

async function resetData() {
  await prisma.payment.deleteMany({});
  await prisma.creditTransaction.deleteMany({});
  await prisma.debitTransaction.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.supplier.deleteMany({});
  await prisma.reminder.deleteMany({});
  await prisma.business.deleteMany({});
  await prisma.otpChallenge.deleteMany({ where: { phone } });
  await prisma.user.deleteMany({ where: { phone } });
}

describe("credit / debit / reminders / dashboard", () => {
  let token: string;

  beforeEach(async () => {
    await resetData();
    token = await authenticate(app, phone);
    await setUpBusiness(app, token);
  });

  afterAll(async () => {
    await resetData();
    await prisma.$disconnect();
  });

  function auth(req: request.Test) {
    return req.set("Authorization", `Bearer ${token}`);
  }

  it("creates a credit transaction against a new customer by name", async () => {
    const res = await auth(request(app).post("/transactions/credit")).send({
      customerName: "Kumar",
      amount: 2000,
      dueDate: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(res.status).toBe(201);
    expect(res.body.data.customer.name).toBe("Kumar");
    expect(res.body.data.status).toBe("PENDING");

    const customers = await auth(request(app).get("/customers"));
    expect(customers.body.data).toHaveLength(1);
    expect(customers.body.data[0].pendingTotal).toBe(2000);
  });

  it("reuses the same customer on a repeat name across two credit entries", async () => {
    await auth(request(app).post("/transactions/credit")).send({ customerName: "Kumar", amount: 1000 });
    await auth(request(app).post("/transactions/credit")).send({ customerName: "kumar", amount: 500 });

    const customers = await auth(request(app).get("/customers"));
    expect(customers.body.data).toHaveLength(1);
    expect(customers.body.data[0].pendingTotal).toBe(1500);
  });

  it("supports partial payment, rejects overpayment, and marks paid", async () => {
    const create = await auth(request(app).post("/transactions/credit")).send({
      customerName: "Ravi",
      amount: 1000,
    });
    const id = create.body.data.id;

    const partial = await auth(request(app).post(`/transactions/credit/${id}/payments`)).send({ amount: 400 });
    expect(partial.status).toBe(200);
    expect(partial.body.data.status).toBe("PARTIALLY_PAID");
    expect(partial.body.data.paidAmount).toBe("400");

    const overpay = await auth(request(app).post(`/transactions/credit/${id}/payments`)).send({ amount: 1000 });
    expect(overpay.status).toBe(400);

    const markPaid = await auth(request(app).post(`/transactions/credit/${id}/mark-paid`));
    expect(markPaid.status).toBe(200);
    expect(markPaid.body.data.status).toBe("PAID");
    expect(markPaid.body.data.paidAmount).toBe("1000");

    const alreadyPaid = await auth(request(app).post(`/transactions/credit/${id}/mark-paid`));
    expect(alreadyPaid.status).toBe(400);
  });

  it("creates a debit transaction against a supplier and lists it", async () => {
    const res = await auth(request(app).post("/transactions/debit")).send({
      supplierName: "Murugan Traders",
      amount: 15000,
      dueDate: new Date(Date.now() + 3 * 86400000).toISOString(),
    });
    expect(res.status).toBe(201);
    expect(res.body.data.supplier.name).toBe("Murugan Traders");

    const suppliers = await auth(request(app).get("/suppliers"));
    expect(suppliers.body.data[0].pendingTotal).toBe(15000);
  });

  it("blocks amount edits once a payment has been recorded", async () => {
    const create = await auth(request(app).post("/transactions/credit")).send({ customerName: "Anitha", amount: 500 });
    const id = create.body.data.id;
    await auth(request(app).post(`/transactions/credit/${id}/payments`)).send({ amount: 100 });

    const edit = await auth(request(app).put(`/transactions/credit/${id}`)).send({ amount: 900 });
    expect(edit.status).toBe(400);
  });

  it("surfaces pending transactions and custom reminders together, sorted by due date", async () => {
    const soon = new Date(Date.now() + 86400000).toISOString();
    const later = new Date(Date.now() + 5 * 86400000).toISOString();

    await auth(request(app).post("/transactions/credit")).send({ customerName: "Kumar", amount: 2000, dueDate: later });
    await auth(request(app).post("/transactions/debit")).send({ supplierName: "ABC Traders", amount: 5000, dueDate: soon });
    await auth(request(app).post("/reminders")).send({ title: "Renew shop license", dueDate: soon });

    const res = await auth(request(app).get("/reminders"));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data[0].dueDate <= res.body.data[1].dueDate).toBe(true);
    const kinds = res.body.data.map((r: { kind: string }) => r.kind).sort();
    expect(kinds).toEqual(["COLLECTION", "CUSTOM", "PAYMENT"]);
  });

  it("reflects receivable/payable totals and 7-day pressure on the dashboard", async () => {
    const in3Days = new Date(Date.now() + 3 * 86400000).toISOString();
    const in20Days = new Date(Date.now() + 20 * 86400000).toISOString();

    await auth(request(app).post("/transactions/credit")).send({ customerName: "Kumar", amount: 2000, dueDate: in3Days });
    await auth(request(app).post("/transactions/debit")).send({ supplierName: "ABC Traders", amount: 5000, dueDate: in3Days });
    await auth(request(app).post("/transactions/debit")).send({ supplierName: "XYZ Traders", amount: 9000, dueDate: in20Days });

    const res = await auth(request(app).get("/dashboard"));
    expect(res.status).toBe(200);
    expect(res.body.data.receivableTotal).toBe(2000);
    expect(res.body.data.payableTotal).toBe(14000);
    expect(res.body.data.netPosition).toBe(2000 - 14000);
    expect(res.body.data.upcoming7DayPayments).toBe(5000);
    expect(res.body.data.upcoming7DayCollections).toBe(2000);
    expect(res.body.data.insights.length).toBeGreaterThan(0);
  });
});
