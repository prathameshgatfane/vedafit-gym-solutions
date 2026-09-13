import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PaymentsListPage } from "./PaymentsListPage";
import { apiClient } from "../../lib/api-client";
import { useSessionStore, type SessionUser } from "../../stores/session.store";
import { renderWithProviders, testOrganization, testUser } from "../../test/test-utils";
import type { Payment } from "./payment.types";

let mock: MockAdapter;

const LIST_PATH = `/organizations/${testOrganization.id}/payments`;

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "01k4h0payment00000000001",
    organizationId: testOrganization.id,
    memberId: "01k4h0member0000000000001",
    membershipId: null,
    invoiceId: "01k4h0invoice00000000001",
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
      id: "01k4h0invoice00000000001",
      invoiceNumber: "INV-2026-000123",
      amountTotal: "1000.00",
      status: "PAID",
    },
    ...overrides,
  };
}

const refundRow = payment({
  id: "01k4h0payment00000000002",
  amount: "-250.00",
  status: "REFUNDED",
  refundOfPaymentId: "01k4h0payment00000000001",
  isRefund: true,
});

const accountant: SessionUser = {
  ...testUser,
  role: { id: "role_a", name: "ACCOUNTANT", permissions: ["payments.view", "payments.refund"] },
};

function renderList(user: SessionUser = accountant, route = "/payments") {
  useSessionStore.getState().setSession({ user, organization: testOrganization, branches: [] });
  return renderWithProviders(<PaymentsListPage />, { route });
}

function reply(items: Payment[], total = items.length) {
  mock.onGet(LIST_PATH).reply(200, {
    success: true,
    data: items,
    pagination: { page: 1, limit: 10, total, totalPages: Math.max(1, Math.ceil(total / 10)) },
  });
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
});

afterEach(() => {
  mock.restore();
});

describe("PaymentsListPage — the ledger", () => {
  it("shows receipts and refunds as separate rows, the refund signed negative", async () => {
    reply([payment(), refundRow]);
    renderList();

    expect(await screen.findByTestId("payment-row")).toHaveTextContent("₹1,000.00");
    expect(screen.getByTestId("refund-row")).toHaveTextContent("−₹250.00");
    // Both are entries in their own right — a refund never overwrote the receipt.
    expect(screen.getAllByTestId("payment-amount")).toHaveLength(2);
  });

  it("nets receipts against refunds for the rows on screen", async () => {
    reply([payment(), refundRow]);
    renderList();

    expect(await screen.findByTestId("net-total")).toHaveTextContent("₹750.00");
  });

  it("filters to refunds only", async () => {
    reply([payment(), refundRow]);
    renderList();

    await screen.findByTestId("payment-row");
    await userEvent.selectOptions(screen.getByLabelText("Entry type"), "REFUNDED");

    await waitFor(() => {
      expect(mock.history.get.at(-1)!.params).toMatchObject({ status: "REFUNDED" });
    });
  });

  it("debounces the search box into a single request", async () => {
    reply([payment()]);
    renderList();

    await screen.findByTestId("payment-row");
    const before = mock.history.get.length;

    await userEvent.type(screen.getByLabelText("Search"), "Aarav");

    await waitFor(() => {
      expect(mock.history.get.at(-1)!.params).toMatchObject({ search: "Aarav" });
    });
    expect(mock.history.get.length - before).toBe(1);
  });

  it("states that the ledger is append-only, so nobody looks for an edit button", async () => {
    reply([payment()]);
    renderList();

    expect(
      await screen.findByText(/nothing here is ever changed or removed after the fact/i),
    ).toBeInTheDocument();
  });

  it("shows an empty state and a readable API error", async () => {
    reply([]);
    const { unmount } = renderList();
    expect(await screen.findByText("No payments yet.")).toBeInTheDocument();
    unmount();

    mock.reset();
    mock.onGet(LIST_PATH).reply(502, "<html>Bad Gateway</html>");
    renderList();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load payments.");
  });
});
