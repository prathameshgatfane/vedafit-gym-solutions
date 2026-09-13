import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExpensesListPage } from "./ExpensesListPage";
import { apiClient } from "../../lib/api-client";
import { useSessionStore, type SessionUser } from "../../stores/session.store";
import {
  renderWithProviders,
  testBranches,
  testOrganization,
  testUser,
} from "../../test/test-utils";
import type { Expense } from "./expense.types";

let mock: MockAdapter;

const LIST_PATH = `/organizations/${testOrganization.id}/expenses`;

const accountant: SessionUser = {
  ...testUser,
  role: { id: "role_a", name: "ACCOUNTANT", permissions: ["expenses.manage", "reports.view"] },
};

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "01k4h0expense00000000001",
    organizationId: testOrganization.id,
    branchId: testBranches[0]!.id,
    category: "RENT",
    amount: "15000.00",
    expenseDate: "2026-09-05",
    paidTo: "Landlord",
    notes: null,
    createdByUserId: accountant.id,
    createdAt: "2026-09-05T10:00:00.000Z",
    updatedAt: "2026-09-05T10:00:00.000Z",
    branch: { id: testBranches[0]!.id, name: "Main Branch" },
    createdBy: { id: accountant.id, name: "Accounts", email: "accounts@demo-gym.test" },
    ...overrides,
  };
}

function renderList() {
  useSessionStore.getState().setSession({
    user: accountant,
    organization: testOrganization,
    branches: testBranches,
  });
  return renderWithProviders(<ExpensesListPage />, { route: "/expenses" });
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
});

afterEach(() => {
  mock.restore();
});

describe("ExpensesListPage", () => {
  it("renders expenses with formatted amounts", async () => {
    mock.onGet(LIST_PATH).reply(200, {
      success: true,
      data: [expense()],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });

    renderList();

    expect(await screen.findByText("Landlord")).toBeInTheDocument();
    const rows = within(screen.getByTestId("expenses-table")).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Rent");
    expect(rows[1]).toHaveTextContent("15,000.00");
    expect(screen.getByRole("button", { name: /add expense/i })).toBeInTheDocument();
  });

  it("deletes after confirmation", async () => {
    let rows = [expense()];
    mock.onGet(LIST_PATH).reply(() => [
      200,
      { success: true, data: rows, pagination: { page: 1, limit: 10, total: rows.length, totalPages: 1 } },
    ]);
    mock.onDelete(`${LIST_PATH}/${rows[0]!.id}`).reply(() => {
      rows = [];
      return [200, { success: true, data: null }];
    });

    renderList();
    await screen.findByText("Landlord");
    await userEvent.click(screen.getByTestId("delete-expense"));
    await userEvent.click(screen.getByTestId("confirm-delete-expense"));
    expect(await screen.findByText("No expenses yet.")).toBeInTheDocument();
  });
});
