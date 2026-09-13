import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvoiceDetailPage } from "./InvoiceDetailPage";
import { apiClient } from "../../lib/api-client";
import { useSessionStore, type SessionUser } from "../../stores/session.store";
import {
  renderWithProviders,
  testBranches,
  testOrganization,
  testUser,
} from "../../test/test-utils";
import type { Payment } from "../payments/payment.types";
import type { Invoice } from "./invoice.types";

let mock: MockAdapter;

const INVOICE_ID = "01k4h0invoice00000000001";
const PAYMENT_ID = "01k4h0payment00000000001";
const DETAIL_PATH = `/organizations/${testOrganization.id}/invoices/${INVOICE_ID}`;
const PAYMENTS_PATH = `/organizations/${testOrganization.id}/payments`;

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: INVOICE_ID,
    organizationId: testOrganization.id,
    memberId: "01k4h0member0000000000001",
    membershipId: null,
    invoiceNumber: "INV-2026-000123",
    amountTotal: "1000.00",
    amountPaid: "0.00",
    amountPending: "1000.00",
    status: "UNPAID",
    notes: "Gold — Monthly",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    member: {
      id: "01k4h0member0000000000001",
      firstName: "Aarav",
      lastName: "Singh",
      phone: "+919000000001",
    },
    membership: null,
    ...overrides,
  };
}

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: PAYMENT_ID,
    organizationId: testOrganization.id,
    memberId: "01k4h0member0000000000001",
    membershipId: null,
    invoiceId: INVOICE_ID,
    amount: "1000.00",
    method: "CASH",
    status: "SUCCESS",
    refundOfPaymentId: null,
    isRefund: false,
    paidAt: "2026-09-02T10:00:00.000Z",
    createdAt: "2026-09-02T10:00:00.000Z",
    member: {
      id: "01k4h0member0000000000001",
      firstName: "Aarav",
      lastName: "Singh",
      phone: "+919000000001",
    },
    invoice: {
      id: INVOICE_ID,
      invoiceNumber: "INV-2026-000123",
      amountTotal: "1000.00",
      status: "PAID",
    },
    ...overrides,
  };
}

/** Section 4.2: an accountant is the only default role that may return money. */
const accountant: SessionUser = {
  ...testUser,
  role: {
    id: "role_a",
    name: "ACCOUNTANT",
    permissions: [
      "invoices.view",
      "invoices.manage",
      "payments.view",
      "payments.create",
      "payments.refund",
    ],
  },
};

/** Takes money at the counter, reads the ledger, but cannot give any back. */
const receptionist: SessionUser = {
  ...testUser,
  role: {
    id: "role_r",
    name: "RECEPTIONIST",
    permissions: ["invoices.view", "payments.view", "payments.create"],
  },
};

function renderDetail(user: SessionUser = accountant) {
  useSessionStore.getState().setSession({
    user,
    organization: testOrganization,
    branches: testBranches,
  });

  return renderWithProviders(
    <Routes>
      <Route path="/invoices" element={<h1>Invoices list</h1>} />
      <Route path="/invoices/:invoiceId" element={<InvoiceDetailPage />} />
    </Routes>,
    { route: `/invoices/${INVOICE_ID}` },
  );
}

function mockLedger(payments: Payment[] = []) {
  mock.onGet(PAYMENTS_PATH).reply(200, {
    success: true,
    data: payments,
    pagination: { page: 1, limit: 100, total: payments.length, totalPages: 1 },
  });
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
  mockLedger();
});

afterEach(() => {
  mock.restore();
});

describe("InvoiceDetailPage — the invoice as a bill", () => {
  it("shows total, collected and outstanding as separate figures", async () => {
    mock.onGet(DETAIL_PATH).reply(200, {
      success: true,
      data: invoice({ amountPaid: "300.00", amountPending: "700.00", status: "PARTIALLY_PAID" }),
    });
    renderDetail();

    expect(await screen.findByTestId("invoice-heading")).toHaveTextContent("INV-2026-000123");
    expect(screen.getByTestId("amount-total")).toHaveTextContent("₹1,000.00");
    expect(screen.getByTestId("amount-paid")).toHaveTextContent("₹300.00");
    expect(screen.getByTestId("amount-pending")).toHaveTextContent("₹700.00");
    expect(screen.getByTestId("status-badge")).toHaveTextContent("PART PAID");
  });

  it("surfaces a failure to load rather than rendering an empty bill", async () => {
    mock.onGet(DETAIL_PATH).reply(404, {
      success: false,
      error: { code: "INVOICE_NOT_FOUND", message: 'Invoice "x" not found' },
    });
    renderDetail();

    expect(await screen.findByRole("alert")).toHaveTextContent("not found");
  });
});

describe("InvoiceDetailPage — recording payments (1.16.2)", () => {
  it("records a part payment and reports what is still outstanding", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: invoice() });
    mock.onPost(PAYMENTS_PATH).reply(201, {
      success: true,
      data: {
        payment: payment({ amount: "400.00" }),
        invoice: invoice({
          amountPaid: "400.00",
          amountPending: "600.00",
          status: "PARTIALLY_PAID",
        }),
      },
    });

    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "Record payment" }));
    await userEvent.type(screen.getByLabelText("Amount (₹)"), "400");
    await userEvent.click(screen.getByTestId("confirm-payment"));

    expect(await screen.findByTestId("action-notice")).toHaveTextContent(
      "₹600.00 still outstanding",
    );

    const body = JSON.parse(mock.history.post[0]!.data);
    expect(body).toMatchObject({ invoiceId: INVOICE_ID, amount: 400, method: "CASH" });
  });

  it("says so plainly when a payment settles the bill in full", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: invoice() });
    mock.onPost(PAYMENTS_PATH).reply(201, {
      success: true,
      data: {
        payment: payment(),
        invoice: invoice({ amountPaid: "1000.00", amountPending: "0.00", status: "PAID" }),
      },
    });

    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "Record payment" }));
    await userEvent.type(screen.getByLabelText("Amount (₹)"), "1000");
    await userEvent.click(screen.getByTestId("confirm-payment"));

    expect(await screen.findByTestId("action-notice")).toHaveTextContent("settled in full");
  });

  it("shows the server's overpayment refusal verbatim, naming the real balance", async () => {
    mock.onGet(DETAIL_PATH).reply(200, {
      success: true,
      data: invoice({ amountPaid: "600.00", amountPending: "400.00", status: "PARTIALLY_PAID" }),
    });
    mock.onPost(PAYMENTS_PATH).reply(409, {
      success: false,
      error: {
        code: "PAYMENT_EXCEEDS_INVOICE",
        message: "Invoice INV-2026-000123 has 400.00 outstanding — 5000.00 is more than that",
      },
    });

    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "Record payment" }));
    await userEvent.type(screen.getByLabelText("Amount (₹)"), "5000");
    await userEvent.click(screen.getByTestId("confirm-payment"));

    expect(await screen.findByRole("alert")).toHaveTextContent("400.00 outstanding");
  });

  it("rejects a non-numeric or zero amount without calling the API", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: invoice() });
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "Record payment" }));
    await userEvent.type(screen.getByLabelText("Amount (₹)"), "0");
    await userEvent.click(screen.getByTestId("confirm-payment"));

    expect(await screen.findByRole("alert")).toHaveTextContent("greater than zero");
    expect(mock.history.post).toHaveLength(0);
  });

  it("offers no payment button once the bill is settled", async () => {
    mock.onGet(DETAIL_PATH).reply(200, {
      success: true,
      data: invoice({ amountPaid: "1000.00", amountPending: "0.00", status: "PAID" }),
    });
    renderDetail();

    await screen.findByTestId("invoice-heading");
    expect(screen.queryByRole("button", { name: "Record payment" })).not.toBeInTheDocument();
  });

  it("offers no payment button on a cancelled invoice", async () => {
    mock.onGet(DETAIL_PATH).reply(200, {
      success: true,
      data: invoice({ status: "CANCELLED" }),
    });
    renderDetail();

    await screen.findByTestId("invoice-heading");
    expect(screen.queryByRole("button", { name: "Record payment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel invoice" })).not.toBeInTheDocument();
  });
});

describe("InvoiceDetailPage — payment history and refunds (1.16.3)", () => {
  it("lists receipts and refunds together, showing a reversal as a negative entry", async () => {
    mock.onGet(DETAIL_PATH).reply(200, {
      success: true,
      data: invoice({ amountPaid: "750.00", amountPending: "250.00", status: "PARTIALLY_PAID" }),
    });
    mockLedger([
      payment(),
      payment({
        id: "01k4h0payment00000000002",
        amount: "-250.00",
        status: "REFUNDED",
        refundOfPaymentId: PAYMENT_ID,
        isRefund: true,
      }),
    ]);

    renderDetail();

    const history = await screen.findByTestId("payment-history");
    expect(within(history).getByTestId("payment-row")).toHaveTextContent("₹1,000.00");
    // The minus sits outside the rupee sign, the way a ledger reads.
    expect(within(history).getByTestId("refund-row")).toHaveTextContent("−₹250.00");
  });

  it("warns that the original payment stays untouched before issuing a refund", async () => {
    mock.onGet(DETAIL_PATH).reply(200, {
      success: true,
      data: invoice({ amountPaid: "1000.00", amountPending: "0.00", status: "PAID" }),
    });
    mockLedger([payment()]);

    renderDetail();

    await userEvent.click(await screen.findByTestId("refund-button"));

    const dialog = screen.getByTestId("confirm-refund");
    expect(dialog).toHaveTextContent(/original payment stays on the record/i);
    expect(dialog).toHaveTextContent(/audit log/i);
    // Pre-filled with the full amount, but editable — partial refunds are allowed.
    expect(screen.getByLabelText("Refund amount (₹)")).toHaveValue("1000.00");
  });

  it("issues a partial refund with a reason and reports the new balance", async () => {
    mock.onGet(DETAIL_PATH).reply(200, {
      success: true,
      data: invoice({ amountPaid: "1000.00", amountPending: "0.00", status: "PAID" }),
    });
    mockLedger([payment()]);
    mock.onPost(`${PAYMENTS_PATH}/${PAYMENT_ID}/refund`).reply(201, {
      success: true,
      data: {
        refund: payment({ id: "r1", amount: "-400.00", status: "REFUNDED", isRefund: true }),
        original: payment(),
        invoice: invoice({
          amountPaid: "600.00",
          amountPending: "400.00",
          status: "PARTIALLY_PAID",
        }),
      },
    });

    renderDetail();

    await userEvent.click(await screen.findByTestId("refund-button"));
    const amountField = screen.getByLabelText("Refund amount (₹)");
    await userEvent.clear(amountField);
    await userEvent.type(amountField, "400");
    await userEvent.type(screen.getByLabelText("Reason (optional)"), "Left early");
    await userEvent.click(screen.getByTestId("submit-refund"));

    expect(await screen.findByTestId("action-notice")).toHaveTextContent(
      "the original payment is unchanged",
    );
    expect(screen.getByTestId("action-notice")).toHaveTextContent("₹400.00 outstanding");

    const body = JSON.parse(mock.history.post[0]!.data);
    expect(body).toEqual({ amount: 400, reason: "Left early" });
  });

  it("surfaces the server's cap when a refund would exceed the payment", async () => {
    mock.onGet(DETAIL_PATH).reply(200, {
      success: true,
      data: invoice({ amountPaid: "1000.00", amountPending: "0.00", status: "PAID" }),
    });
    mockLedger([payment()]);
    mock.onPost(`${PAYMENTS_PATH}/${PAYMENT_ID}/refund`).reply(409, {
      success: false,
      error: {
        code: "REFUND_EXCEEDS_PAYMENT",
        message: "This payment collected 1000.00 — 2000.00 is more than that",
      },
    });

    renderDetail();

    await userEvent.click(await screen.findByTestId("refund-button"));
    const amountField = screen.getByLabelText("Refund amount (₹)");
    await userEvent.clear(amountField);
    await userEvent.type(amountField, "2000");
    await userEvent.click(screen.getByTestId("submit-refund"));

    expect(await screen.findByRole("alert")).toHaveTextContent("is more than that");
  });

  it("offers no refund button against a row that is itself a refund", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: invoice() });
    mockLedger([
      payment({
        id: "01k4h0payment00000000002",
        amount: "-250.00",
        status: "REFUNDED",
        refundOfPaymentId: PAYMENT_ID,
        isRefund: true,
      }),
    ]);

    renderDetail();

    await screen.findByTestId("refund-row");
    expect(screen.queryByTestId("refund-button")).not.toBeInTheDocument();
  });
});

describe("InvoiceDetailPage — RBAC (Section 4.2)", () => {
  it("gives a RECEPTIONIST the payment button but never the refund one", async () => {
    mock.onGet(DETAIL_PATH).reply(200, {
      success: true,
      data: invoice({ amountPaid: "500.00", amountPending: "500.00", status: "PARTIALLY_PAID" }),
    });
    mockLedger([payment({ amount: "500.00" })]);

    renderDetail(receptionist);

    expect(await screen.findByRole("button", { name: "Record payment" })).toBeInTheDocument();
    // They can read the history — that's how they answer "how much do I owe?" — but not reverse it.
    expect(screen.getByTestId("payment-history")).toBeInTheDocument();
    expect(screen.queryByTestId("refund-button")).not.toBeInTheDocument();
    // And raising or voiding a bill is above them too.
    expect(screen.queryByRole("button", { name: "Cancel invoice" })).not.toBeInTheDocument();
  });

  it("gives an ACCOUNTANT the refund and cancel actions", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: invoice() });
    mockLedger([payment()]);

    renderDetail(accountant);

    expect(await screen.findByTestId("refund-button")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel invoice" })).toBeInTheDocument();
  });

  it("hides the payment history entirely from someone without payments.view", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: invoice() });
    const viewer: SessionUser = {
      ...testUser,
      role: { id: "role_v", name: "VIEWER", permissions: ["invoices.view"] },
    };

    renderDetail(viewer);

    await screen.findByTestId("invoice-heading");
    expect(screen.queryByTestId("payment-history")).not.toBeInTheDocument();
  });
});

describe("InvoiceDetailPage — cancelling (1.16.2)", () => {
  it("explains why cancel-and-reissue is the correction path, then cancels", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: invoice() });
    mock.onPost(`${DETAIL_PATH}/cancel`).reply(200, {
      success: true,
      data: invoice({ status: "CANCELLED" }),
    });

    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "Cancel invoice" }));
    const dialog = screen.getByTestId("confirm-cancel-invoice");
    expect(dialog).toHaveTextContent(/amount billed can't be edited/i);

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel invoice" }));

    await waitFor(() =>
      expect(screen.getByTestId("action-notice")).toHaveTextContent("Invoice cancelled"),
    );
  });

  it("offers no cancel once money has been collected", async () => {
    mock.onGet(DETAIL_PATH).reply(200, {
      success: true,
      data: invoice({ amountPaid: "100.00", amountPending: "900.00", status: "PARTIALLY_PAID" }),
    });
    renderDetail();

    await screen.findByTestId("invoice-heading");
    expect(screen.queryByRole("button", { name: "Cancel invoice" })).not.toBeInTheDocument();
  });
});
