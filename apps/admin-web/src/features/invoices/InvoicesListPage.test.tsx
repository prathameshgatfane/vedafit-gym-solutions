import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvoicesListPage } from "./InvoicesListPage";
import { apiClient } from "../../lib/api-client";
import { useSessionStore, type SessionUser } from "../../stores/session.store";
import {
  renderWithProviders,
  testOrganization,
  testUser,
} from "../../test/test-utils";
import type { Invoice } from "./invoice.types";

let mock: MockAdapter;

const LIST_PATH = `/organizations/${testOrganization.id}/invoices`;

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "01k4h0invoice00000000001",
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

const accountant: SessionUser = {
  ...testUser,
  role: {
    id: "role_a",
    name: "ACCOUNTANT",
    permissions: ["invoices.view", "invoices.manage", "payments.view"],
  },
};

/** Reads bills to answer "how much do I owe?", but doesn't raise them. */
const receptionist: SessionUser = {
  ...testUser,
  role: { id: "role_r", name: "RECEPTIONIST", permissions: ["invoices.view", "payments.create"] },
};

function renderList(user: SessionUser = accountant, route = "/invoices") {
  useSessionStore.getState().setSession({
    user,
    organization: testOrganization,
    branches: [],
  });
  return renderWithProviders(<InvoicesListPage />, { route });
}

function reply(items: Invoice[], total = items.length, limit = 10) {
  mock.onGet(LIST_PATH).reply(200, {
    success: true,
    data: items,
    pagination: { page: 1, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
});

afterEach(() => {
  mock.restore();
});

describe("InvoicesListPage", () => {
  it("renders each bill with its number, total and outstanding balance", async () => {
    reply([invoice({ amountPaid: "400.00", amountPending: "600.00", status: "PARTIALLY_PAID" })]);
    renderList();

    expect(await screen.findByTestId("invoice-number")).toHaveTextContent("INV-2026-000123");
    expect(screen.getByTestId("invoice-pending")).toHaveTextContent("₹600.00");
    expect(screen.getByTestId("status-badge")).toHaveTextContent("PART PAID");
  });

  it("totals the outstanding balance across the rows on screen", async () => {
    reply([
      invoice({ id: "a", amountPending: "600.00" }),
      invoice({ id: "b", invoiceNumber: "INV-2026-000124", amountPending: "150.50" }),
    ]);
    renderList();

    expect(await screen.findByTestId("outstanding-total")).toHaveTextContent("₹750.50");
  });

  it("asks the API for outstanding bills only when the pending-fees box is ticked", async () => {
    reply([invoice()]);
    renderList();

    await screen.findByTestId("invoice-number");
    await userEvent.click(screen.getByTestId("outstanding-toggle"));

    await waitFor(() => {
      const last = mock.history.get.at(-1)!;
      expect(last.params).toMatchObject({ outstanding: "true" });
    });
  });

  it("debounces typing in the search box into a single request", async () => {
    reply([invoice()]);
    renderList();

    await screen.findByTestId("invoice-number");
    const before = mock.history.get.length;

    await userEvent.type(screen.getByLabelText("Search"), "Aarav");

    await waitFor(() => {
      const last = mock.history.get.at(-1)!;
      expect(last.params).toMatchObject({ search: "Aarav" });
    });
    // Five keystrokes, one extra request — not five.
    expect(mock.history.get.length - before).toBe(1);
  });

  it("passes the status filter through and resets to the first page", async () => {
    reply([invoice()], 40);
    renderList(accountant, "/invoices?page=3");

    await screen.findByTestId("invoice-number");
    await userEvent.selectOptions(screen.getByLabelText("Status"), "PAID");

    await waitFor(() => {
      const last = mock.history.get.at(-1)!;
      expect(last.params).toMatchObject({ status: "PAID", page: 1 });
    });
  });

  it("shows a filter-aware empty state", async () => {
    reply([]);
    renderList(accountant, "/invoices?search=nobody");

    expect(await screen.findByText("No invoices match those filters.")).toBeInTheDocument();
  });

  it("falls back to a readable message when the API is unreachable", async () => {
    mock.onGet(LIST_PATH).reply(502, "<html>Bad Gateway</html>");
    renderList();

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load invoices.");
  });

  it("offers 'Raise invoice' to invoices.manage and hides it from a receptionist", async () => {
    reply([invoice()]);
    const { unmount } = renderList(accountant);
    expect(await screen.findByRole("button", { name: "Raise invoice" })).toBeInTheDocument();
    unmount();

    renderList(receptionist);
    await screen.findByTestId("invoice-number");
    expect(screen.queryByRole("button", { name: "Raise invoice" })).not.toBeInTheDocument();
  });

  it("says out loud that membership invoices raise themselves", async () => {
    reply([invoice()]);
    renderList();

    expect(
      await screen.findByText(/raises its invoice automatically/i),
    ).toBeInTheDocument();
  });

  it("pages through results without losing the filters", async () => {
    reply([invoice()], 25);
    renderList();

    await screen.findByTestId("invoice-number");
    expect(screen.getByTestId("pagination-summary")).toHaveTextContent("Page 1 of 3");

    await userEvent.click(within(screen.getByTestId("pagination-summary").parentElement!).getByRole("button", { name: "Next" }));

    await waitFor(() => {
      const last = mock.history.get.at(-1)!;
      expect(last.params).toMatchObject({ page: 2 });
    });
  });
});
