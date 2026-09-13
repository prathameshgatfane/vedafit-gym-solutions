import { screen } from "@testing-library/react";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProfitLossPage } from "./ProfitLossPage";
import { apiClient } from "../../lib/api-client";
import { useSessionStore, type SessionUser } from "../../stores/session.store";
import {
  renderWithProviders,
  testBranches,
  testOrganization,
  testUser,
} from "../../test/test-utils";
import type { ProfitLossReport } from "../expenses/expense.types";

let mock: MockAdapter;

const PNL_PATH = `/organizations/${testOrganization.id}/reports/profit-loss`;

const accountant: SessionUser = {
  ...testUser,
  role: { id: "role_a", name: "ACCOUNTANT", permissions: ["expenses.manage", "reports.view"] },
};

function report(overrides: Partial<ProfitLossReport> = {}): ProfitLossReport {
  return {
    timezone: "Asia/Kolkata",
    from: "2026-09",
    to: "2026-09",
    scope: { branchId: null, branchName: null },
    revenue: "20000.00",
    expenses: "8500.00",
    net: "11500.00",
    byCategory: [
      { category: "RENT", total: "8000.00" },
      { category: "SOFTWARE", total: "500.00" },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
});

afterEach(() => {
  mock.restore();
});

describe("ProfitLossPage", () => {
  it("shows revenue, expenses, net and category totals", async () => {
    mock.onGet(PNL_PATH).reply(200, { success: true, data: report() });
    useSessionStore.getState().setSession({
      user: accountant,
      organization: testOrganization,
      branches: testBranches,
    });
    renderWithProviders(<ProfitLossPage />, { route: "/reports" });

    expect(await screen.findByTestId("pnl-revenue")).toHaveTextContent("20,000.00");
    expect(screen.getByTestId("pnl-expenses")).toHaveTextContent("8,500.00");
    expect(screen.getByTestId("pnl-net")).toHaveTextContent("11,500.00");
    expect(screen.getByTestId("pnl-categories")).toHaveTextContent("Rent");
    expect(screen.getByTestId("pnl-categories")).toHaveTextContent("Software");
  });
});
