import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../../../test/helpers/app";
import {
  bearer,
  createActor,
  createTestTenant,
  type TestActor,
  type TestTenant,
} from "../../../test/helpers/auth";
import { generateId } from "../../lib/id";
import { prisma } from "../../lib/prisma";

let tenant: TestTenant;
let owner: TestActor;
let accountant: TestActor;
let manager: TestActor;
let receptionist: TestActor;
let trainer: TestActor;

function paymentsUrl(actor: TestActor, suffix = "") {
  return `/api/v1/organizations/${actor.organization.id}/payments${suffix}`;
}

function invoicesUrl(actor: TestActor, suffix = "") {
  return `/api/v1/organizations/${actor.organization.id}/invoices${suffix}`;
}

async function createMember(overrides: { branchId?: string } = {}) {
  const suffix = generateId().slice(-9);
  return prisma.member.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      branchId: overrides.branchId ?? tenant.branch.id,
      firstName: "Cash",
      lastName: `Payer ${suffix.slice(-4)}`,
      phone: `+9190${suffix}`,
    },
  });
}

interface InvoiceBody {
  id: string;
  invoiceNumber: string;
  amountTotal: string;
  amountPaid: string;
  amountPending: string;
  status: string;
}

interface PaymentBody {
  id: string;
  amount: string;
  method: string;
  status: string;
  refundOfPaymentId: string | null;
  isRefund: boolean;
  memberId: string;
  membershipId: string | null;
  invoiceId: string | null;
}

/** An unpaid invoice for a fresh member, which nearly every test below starts from. */
async function billFor(amount: number, actor: TestActor = owner): Promise<InvoiceBody> {
  const member = await createMember();
  const res = await request(app)
    .post(invoicesUrl(actor))
    .set(...bearer(actor))
    .send({ memberId: member.id, amountTotal: amount, notes: "Test bill" });

  if (res.status !== 201) {
    throw new Error(`Invoice create failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data as InvoiceBody;
}

async function pay(
  actor: TestActor,
  invoiceId: string,
  amount: number,
  method = "CASH",
): Promise<{ payment: PaymentBody; invoice: InvoiceBody }> {
  const res = await request(app)
    .post(paymentsUrl(actor))
    .set(...bearer(actor))
    .send({ invoiceId, amount, method });

  if (res.status !== 201) {
    throw new Error(`Payment failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data as { payment: PaymentBody; invoice: InvoiceBody };
}

beforeAll(async () => {
  tenant = await createTestTenant("Payments");
  owner = await createActor(tenant, "OWNER");
  accountant = await createActor(tenant, "ACCOUNTANT");
  manager = await createActor(tenant, "MANAGER");
  receptionist = await createActor(tenant, "RECEPTIONIST", { branchScoped: true });
  trainer = await createActor(tenant, "TRAINER");
});

describe("payments — partial payments walk the invoice through its statuses (1.16.2)", () => {
  it("goes UNPAID → PARTIALLY_PAID → PAID as instalments land, settling to exactly zero", async () => {
    const bill = await billFor(1000);
    expect(bill.status).toBe("UNPAID");

    const first = await pay(owner, bill.id, 300);
    expect(first.invoice).toMatchObject({
      amountPaid: "300.00",
      amountPending: "700.00",
      status: "PARTIALLY_PAID",
    });

    const second = await pay(owner, bill.id, 250.5, "UPI");
    expect(second.invoice).toMatchObject({
      amountPaid: "550.50",
      amountPending: "449.50",
      status: "PARTIALLY_PAID",
    });

    // The final instalment is exactly what's left — equality is allowed, only more is refused.
    const third = await pay(owner, bill.id, 449.5, "CARD");
    expect(third.invoice).toMatchObject({
      amountPaid: "1000.00",
      amountPending: "0.00",
      status: "PAID",
    });

    // The database agrees with the response, and the three rows are all still there.
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: bill.id } });
    expect(stored.amountPaid.toFixed(2)).toBe("1000.00");
    expect(stored.amountPending.toFixed(2)).toBe("0.00");
    expect(stored.status).toBe("PAID");

    const rows = await prisma.payment.findMany({ where: { invoiceId: bill.id } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "SUCCESS")).toBe(true);
  });

  it("copies member and membership from the invoice rather than trusting the request", async () => {
    const bill = await billFor(200);
    const { payment } = await pay(owner, bill.id, 200);

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: bill.id } });
    expect(payment.memberId).toBe(invoice.memberId);
    expect(payment.membershipId).toBe(invoice.membershipId);
    expect(payment.invoiceId).toBe(bill.id);
    expect(payment.isRefund).toBe(false);
    expect(payment.refundOfPaymentId).toBeNull();
  });

  it("refuses an overpayment and names the outstanding amount (1.16.2)", async () => {
    const bill = await billFor(500);
    await pay(owner, bill.id, 100);

    const res = await request(app)
      .post(paymentsUrl(owner))
      .set(...bearer(owner))
      .send({ invoiceId: bill.id, amount: 5000, method: "CASH" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PAYMENT_EXCEEDS_INVOICE");
    expect(res.body.error.message).toMatch(/400\.00 outstanding/);
    expect(res.body.error.details).toMatchObject({ amountPending: "400.00" });

    // Nothing was written — a rejected payment leaves no trace on the invoice.
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: bill.id } });
    expect(stored.amountPaid.toFixed(2)).toBe("100.00");
    expect(await prisma.payment.count({ where: { invoiceId: bill.id } })).toBe(1);
  });

  it("refuses even a one-paisa overpayment, since the comparison is exact decimal", async () => {
    const bill = await billFor(100);

    const res = await request(app)
      .post(paymentsUrl(owner))
      .set(...bearer(owner))
      .send({ invoiceId: bill.id, amount: 100.01, method: "CASH" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PAYMENT_EXCEEDS_INVOICE");
  });

  it("refuses any payment against a cancelled invoice", async () => {
    const bill = await billFor(300);
    await request(app)
      .post(invoicesUrl(owner, `/${bill.id}/cancel`))
      .set(...bearer(owner));

    const res = await request(app)
      .post(paymentsUrl(owner))
      .set(...bearer(owner))
      .send({ invoiceId: bill.id, amount: 50, method: "CASH" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVOICE_NOT_PAYABLE");
  });

  it("rejects a zero or negative payment — a reversal has its own route", async () => {
    const bill = await billFor(300);

    for (const amount of [0, -50]) {
      const res = await request(app)
        .post(paymentsUrl(owner))
        .set(...bearer(owner))
        .send({ invoiceId: bill.id, amount, method: "CASH" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("404s on an invoice from another organization", async () => {
    const stranger = await createTestTenant("PayStranger");
    const strangerOwner = await createActor(stranger, "OWNER");
    const strangerMember = await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: stranger.organization.id,
        branchId: stranger.branch.id,
        firstName: "Other",
        lastName: "Bill",
        phone: `+9189${generateId().slice(-9)}`,
      },
    });
    const theirBill = await request(app)
      .post(invoicesUrl(strangerOwner))
      .set(...bearer(strangerOwner))
      .send({ memberId: strangerMember.id, amountTotal: 100, notes: "theirs" });

    const res = await request(app)
      .post(paymentsUrl(owner))
      .set(...bearer(owner))
      .send({ invoiceId: theirBill.body.data.id, amount: 100, method: "CASH" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("INVOICE_NOT_FOUND");
  });
});

describe("payments — refunds are new rows, never mutations (1.16.3)", () => {
  it("writes a negative row, leaves the original untouched, and rolls the invoice back", async () => {
    const bill = await billFor(1000);
    const { payment } = await pay(owner, bill.id, 1000);

    const res = await request(app)
      .post(paymentsUrl(accountant, `/${payment.id}/refund`))
      .set(...bearer(accountant))
      .send({ amount: 400, reason: "Member cut the term short" });

    expect(res.status).toBe(201);
    const { refund, original, invoice } = res.body.data as {
      refund: PaymentBody;
      original: PaymentBody;
      invoice: InvoiceBody;
    };

    expect(refund).toMatchObject({
      amount: "-400.00",
      status: "REFUNDED",
      refundOfPaymentId: payment.id,
      isRefund: true,
      invoiceId: bill.id,
    });

    // The original is re-read from the database after the refund lands, not echoed back.
    expect(original).toMatchObject({ id: payment.id, amount: "1000.00", status: "SUCCESS" });

    expect(invoice).toMatchObject({
      amountTotal: "1000.00",
      amountPaid: "600.00",
      amountPending: "400.00",
      status: "PARTIALLY_PAID",
    });

    // Two rows, not one edited row.
    const rows = await prisma.payment.findMany({
      where: { invoiceId: bill.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: payment.id, status: "SUCCESS" });
    expect(rows[0]!.amount.toFixed(2)).toBe("1000.00");
    expect(rows[1]!.amount.toFixed(2)).toBe("-400.00");
  });

  it("writes an AuditLog entry against the original payment, in the same transaction", async () => {
    const bill = await billFor(800);
    const { payment } = await pay(owner, bill.id, 800);

    await request(app)
      .post(paymentsUrl(accountant, `/${payment.id}/refund`))
      .set(...bearer(accountant))
      .send({ amount: 800, reason: "Duplicate charge" });

    const entries = await prisma.auditLog.findMany({
      where: { entityType: "Payment", entityId: payment.id },
    });

    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.action).toBe("REFUND");
    expect(entry.organizationId).toBe(tenant.organization.id);
    // The actor is the signed-in accountant, taken from the JWT — never from the body.
    expect(entry.actorUserId).toBe(accountant.user.id);

    const before = entry.beforeJson as Record<string, unknown>;
    const after = entry.afterJson as Record<string, unknown>;
    expect(before).toMatchObject({ payment: { id: payment.id, amount: "800.00", status: "SUCCESS" } });
    expect(after).toMatchObject({ refundedAmount: "800.00", reason: "Duplicate charge" });
    expect(after.invoice).toMatchObject({
      amountPaid: "0.00",
      amountPending: "800.00",
      status: "UNPAID",
    });
  });

  it("returns a fully refunded PAID invoice to UNPAID without special-casing anything", async () => {
    const bill = await billFor(600);
    const { payment, invoice: paidInvoice } = await pay(owner, bill.id, 600);
    expect(paidInvoice.status).toBe("PAID");

    const res = await request(app)
      .post(paymentsUrl(accountant, `/${payment.id}/refund`))
      .set(...bearer(accountant))
      .send({ amount: 600 });

    expect(res.body.data.invoice).toMatchObject({
      // amountTotal never moves: the member was still billed this much.
      amountTotal: "600.00",
      amountPaid: "0.00",
      amountPending: "600.00",
      status: "UNPAID",
    });
  });

  it("allows repeated partial refunds up to the payment, then refuses the next one", async () => {
    const bill = await billFor(500);
    const { payment } = await pay(owner, bill.id, 500);

    const first = await request(app)
      .post(paymentsUrl(accountant, `/${payment.id}/refund`))
      .set(...bearer(accountant))
      .send({ amount: 200 });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(paymentsUrl(accountant, `/${payment.id}/refund`))
      .set(...bearer(accountant))
      .send({ amount: 300 });
    expect(second.status).toBe(201);
    expect(second.body.data.invoice.amountPaid).toBe("0.00");

    const third = await request(app)
      .post(paymentsUrl(accountant, `/${payment.id}/refund`))
      .set(...bearer(accountant))
      .send({ amount: 1 });
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe("REFUND_EXCEEDS_PAYMENT");
    expect(third.body.error.message).toMatch(/already been refunded/);
    expect(third.body.error.details).toMatchObject({ refundable: "0.00" });

    // The cap held: exactly two refund rows, summing to the original payment.
    const refunds = await prisma.payment.findMany({ where: { refundOfPaymentId: payment.id } });
    expect(refunds).toHaveLength(2);
  });

  it("refuses a refund larger than the payment it targets", async () => {
    const bill = await billFor(250);
    const { payment } = await pay(owner, bill.id, 250);

    const res = await request(app)
      .post(paymentsUrl(accountant, `/${payment.id}/refund`))
      .set(...bearer(accountant))
      .send({ amount: 251 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REFUND_EXCEEDS_PAYMENT");
    expect(await prisma.payment.count({ where: { refundOfPaymentId: payment.id } })).toBe(0);
  });

  it("refuses to refund a refund", async () => {
    const bill = await billFor(300);
    const { payment } = await pay(owner, bill.id, 300);

    const refund = await request(app)
      .post(paymentsUrl(accountant, `/${payment.id}/refund`))
      .set(...bearer(accountant))
      .send({ amount: 100 });

    const res = await request(app)
      .post(paymentsUrl(accountant, `/${refund.body.data.refund.id}/refund`))
      .set(...bearer(accountant))
      .send({ amount: 50 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_REFUND_TARGET");
  });

  it("has no update or delete route for a payment", async () => {
    const bill = await billFor(120);
    const { payment } = await pay(owner, bill.id, 120);

    const patched = await request(app)
      .patch(paymentsUrl(owner, `/${payment.id}`))
      .set(...bearer(owner))
      .send({ amount: 1 });
    expect(patched.status).toBe(404);

    const deleted = await request(app)
      .delete(paymentsUrl(owner, `/${payment.id}`))
      .set(...bearer(owner));
    expect(deleted.status).toBe(404);

    // And the row is exactly as it was.
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.amount.toFixed(2)).toBe("120.00");
    expect(row.status).toBe("SUCCESS");
  });
});

describe("payments — a sold membership raises its own invoice", () => {
  it("bills the snapshot price, links the term, and can then be paid down", async () => {
    const member = await createMember();
    const plan = await prisma.membershipPlan.create({
      data: {
        id: generateId(),
        organizationId: tenant.organization.id,
        name: `Billed ${generateId().slice(-6)}`,
        price: 1500,
        durationDays: 30,
      },
    });

    const sale = await request(app)
      .post(`/api/v1/organizations/${owner.organization.id}/memberships`)
      .set(...bearer(owner))
      .send({ memberId: member.id, planId: plan.id });
    expect(sale.status).toBe(201);

    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { membershipId: sale.body.data.id },
    });
    expect(invoice.amountTotal.toFixed(2)).toBe("1500.00");
    expect(invoice.amountPending.toFixed(2)).toBe("1500.00");
    expect(invoice.status).toBe("UNPAID");
    expect(invoice.memberId).toBe(member.id);
    expect(invoice.notes).toContain(plan.name);

    const { payment, invoice: settled } = await pay(owner, invoice.id, 1500);
    expect(settled.status).toBe("PAID");
    // The payment inherits the term from the invoice, which is what ties revenue to a membership.
    expect(payment.membershipId).toBe(sale.body.data.id);
  });

  it("raises a second invoice on renewal rather than editing the first", async () => {
    const member = await createMember();
    const plan = await prisma.membershipPlan.create({
      data: {
        id: generateId(),
        organizationId: tenant.organization.id,
        name: `Renewed ${generateId().slice(-6)}`,
        price: 900,
        durationDays: 30,
      },
    });

    const sale = await request(app)
      .post(`/api/v1/organizations/${owner.organization.id}/memberships`)
      .set(...bearer(owner))
      .send({ memberId: member.id, planId: plan.id });

    await request(app)
      .post(`/api/v1/organizations/${owner.organization.id}/memberships/${sale.body.data.id}/renew`)
      .set(...bearer(owner))
      .send({});

    const invoices = await prisma.invoice.findMany({ where: { memberId: member.id } });
    expect(invoices).toHaveLength(2);
    expect(invoices.every((i) => i.amountTotal.toFixed(2) === "900.00")).toBe(true);
    // Two different terms, two different bills.
    expect(new Set(invoices.map((i) => i.membershipId)).size).toBe(2);
  });

  it("raises a zero-total, already-PAID invoice for a complimentary plan", async () => {
    const member = await createMember();
    const plan = await prisma.membershipPlan.create({
      data: {
        id: generateId(),
        organizationId: tenant.organization.id,
        name: `Free ${generateId().slice(-6)}`,
        price: 0,
        durationDays: 7,
      },
    });

    const sale = await request(app)
      .post(`/api/v1/organizations/${owner.organization.id}/memberships`)
      .set(...bearer(owner))
      .send({ memberId: member.id, planId: plan.id });

    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { membershipId: sale.body.data.id },
    });
    expect(invoice.amountTotal.toFixed(2)).toBe("0.00");
    expect(invoice.status).toBe("PAID");
  });

  it("reports what a mid-term plan change forfeits, in days and in money, without moving any (1.16.1)", async () => {
    const member = await createMember();
    const [cheap, premium] = await Promise.all([
      prisma.membershipPlan.create({
        data: {
          id: generateId(),
          organizationId: tenant.organization.id,
          name: `Basic ${generateId().slice(-6)}`,
          price: 3000,
          durationDays: 30,
        },
      }),
      prisma.membershipPlan.create({
        data: {
          id: generateId(),
          organizationId: tenant.organization.id,
          name: `Premium ${generateId().slice(-6)}`,
          price: 9000,
          durationDays: 90,
        },
      }),
    ]);

    const sale = await request(app)
      .post(`/api/v1/organizations/${owner.organization.id}/memberships`)
      .set(...bearer(owner))
      .send({ memberId: member.id, planId: cheap.id });

    const changed = await request(app)
      .post(
        `/api/v1/organizations/${owner.organization.id}/memberships/${sale.body.data.id}/change-plan`,
      )
      .set(...bearer(owner))
      .send({ planId: premium.id });

    expect(changed.status).toBe(201);
    // 30 unused days of a 3000/30 term, at the old term's own snapshot rate.
    expect(changed.body.meta).toMatchObject({ forfeitedDays: 30, forfeitedValue: "3000.00" });

    // Reported, not credited: no refund row exists anywhere for this member.
    const refunds = await prisma.payment.findMany({
      where: { memberId: member.id, refundOfPaymentId: { not: null } },
    });
    expect(refunds).toHaveLength(0);

    // And the new plan is billed in full, with the old term's bill left as it was.
    const invoices = await prisma.invoice.findMany({
      where: { memberId: member.id },
      orderBy: { createdAt: "asc" },
    });
    expect(invoices.map((i) => i.amountTotal.toFixed(2))).toEqual(["3000.00", "9000.00"]);
  });
});

describe("payments — list and view", () => {
  it("lists receipts and refunds together, newest activity first, and filters by invoice", async () => {
    const listTenant = await createTestTenant("PaymentList");
    const listOwner = await createActor(listTenant, "OWNER");
    const member = await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: listTenant.organization.id,
        branchId: listTenant.branch.id,
        firstName: "Ledger",
        lastName: "Reader",
        phone: `+9188${generateId().slice(-9)}`,
      },
    });

    const bill = await request(app)
      .post(invoicesUrl(listOwner))
      .set(...bearer(listOwner))
      .send({ memberId: member.id, amountTotal: 1000, notes: "list test" });
    const invoiceId = bill.body.data.id as string;

    const paid = await request(app)
      .post(paymentsUrl(listOwner))
      .set(...bearer(listOwner))
      .send({ invoiceId, amount: 1000, method: "UPI" });

    await request(app)
      .post(paymentsUrl(listOwner, `/${paid.body.data.payment.id}/refund`))
      .set(...bearer(listOwner))
      .send({ amount: 250 });

    const all = await request(app)
      .get(`${paymentsUrl(listOwner)}?invoiceId=${invoiceId}&sortBy=createdAt&sortOrder=asc`)
      .set(...bearer(listOwner));

    expect(all.body.pagination.total).toBe(2);
    expect(all.body.data.map((p: PaymentBody) => p.amount)).toEqual(["1000.00", "-250.00"]);
    expect(all.body.data.map((p: PaymentBody) => p.isRefund)).toEqual([false, true]);

    const refundsOnly = await request(app)
      .get(`${paymentsUrl(listOwner)}?status=REFUNDED`)
      .set(...bearer(listOwner));
    expect(refundsOnly.body.pagination.total).toBe(1);

    // Both rows, because a refund goes back the way the money came in — the reversal inherits
    // the original's method rather than inventing one.
    const byMethod = await request(app)
      .get(`${paymentsUrl(listOwner)}?method=UPI`)
      .set(...bearer(listOwner));
    expect(byMethod.body.pagination.total).toBe(2);

    const bySearch = await request(app)
      .get(`${paymentsUrl(listOwner)}?search=Ledger`)
      .set(...bearer(listOwner));
    expect(bySearch.body.pagination.total).toBe(2);
  });

  it("404s on a payment from another organization", async () => {
    const bill = await billFor(100);
    const { payment } = await pay(owner, bill.id, 100);

    const stranger = await createTestTenant("PayPeek");
    const strangerOwner = await createActor(stranger, "OWNER");

    const res = await request(app)
      .get(paymentsUrl(strangerOwner, `/${payment.id}`))
      .set(...bearer(strangerOwner));
    expect(res.status).toBe(404);
  });

  it("hides another branch's payments from a branch-scoped caller", async () => {
    const otherBranch = await prisma.branch.create({
      data: {
        id: generateId(),
        organizationId: tenant.organization.id,
        name: `Wing ${generateId().slice(-4)}`,
      },
    });
    const elsewhere = await createMember({ branchId: otherBranch.id });
    const bill = await request(app)
      .post(invoicesUrl(owner))
      .set(...bearer(owner))
      .send({ memberId: elsewhere.id, amountTotal: 300, notes: "other branch" });
    const { payment } = await pay(owner, bill.body.data.id, 300);

    const res = await request(app)
      .get(paymentsUrl(receptionist, `/${payment.id}`))
      .set(...bearer(receptionist));
    expect(res.status).toBe(404);
  });
});

describe("payments — RBAC (Section 4.2)", () => {
  it("lets an ACCOUNTANT record and refund", async () => {
    const bill = await billFor(400);
    const taken = await pay(accountant, bill.id, 400);

    const refund = await request(app)
      .post(paymentsUrl(accountant, `/${taken.payment.id}/refund`))
      .set(...bearer(accountant))
      .send({ amount: 400 });

    expect(refund.status).toBe(201);
  });

  it("lets a RECEPTIONIST record and read a payment but never refund one", async () => {
    const bill = await billFor(600);

    const taken = await request(app)
      .post(paymentsUrl(receptionist))
      .set(...bearer(receptionist))
      .send({ invoiceId: bill.id, amount: 600, method: "CASH" });
    expect(taken.status).toBe(201);

    const read = await request(app)
      .get(paymentsUrl(receptionist, `/${taken.body.data.payment.id}`))
      .set(...bearer(receptionist));
    expect(read.status).toBe(200);

    const refund = await request(app)
      .post(paymentsUrl(receptionist, `/${taken.body.data.payment.id}/refund`))
      .set(...bearer(receptionist))
      .send({ amount: 600 });
    expect(refund.status).toBe(403);
    expect(refund.body.error.code).toBe("PERMISSION_DENIED");

    // The refusal left nothing behind — no row, no audit entry, no change to the invoice.
    expect(await prisma.payment.count({ where: { refundOfPaymentId: taken.body.data.payment.id } })).toBe(0);
    expect(
      await prisma.auditLog.count({ where: { entityId: taken.body.data.payment.id } }),
    ).toBe(0);
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: bill.id } });
    expect(invoice.status).toBe("PAID");
  });

  it("lets a MANAGER record a payment but not refund one — running the gym isn't handling the books", async () => {
    const bill = await billFor(700);
    const taken = await pay(manager, bill.id, 700);

    const refund = await request(app)
      .post(paymentsUrl(manager, `/${taken.payment.id}/refund`))
      .set(...bearer(manager))
      .send({ amount: 100 });

    expect(refund.status).toBe(403);
    expect(refund.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("denies a TRAINER entirely", async () => {
    const res = await request(app)
      .get(paymentsUrl(trainer))
      .set(...bearer(trainer));
    expect(res.status).toBe(403);
  });

  it("denies another organization's owner", async () => {
    const stranger = await createTestTenant("PayTenant");
    const strangerOwner = await createActor(stranger, "OWNER");

    const res = await request(app)
      .get(paymentsUrl(owner))
      .set(...bearer(strangerOwner));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORG_MISMATCH");
  });
});
