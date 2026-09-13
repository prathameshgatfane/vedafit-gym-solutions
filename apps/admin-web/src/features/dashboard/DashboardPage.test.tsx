import type { ReactNode } from "react";
import { screen, waitFor } from "@testing-library/react";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage";
import { apiClient } from "../../lib/api-client";
import { useSessionStore, type SessionUser } from "../../stores/session.store";
import { renderWithProviders, testBranches, testOrganization, testUser } from "../../test/test-utils";
import type { Dashboard } from "./dashboard.types";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
  AreaChart: ({ children }: { children: ReactNode }) => <div data-testid="revenue-chart">{children}</div>,
  Area: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));

let mock: MockAdapter;

const PATH = `/organizations/${testOrganization.id}/reports/dashboard`;

const owner: SessionUser = {
  ...testUser,
  role: {
    ...testUser.role,
    permissions: [
      "members.view",
      "reports.view",
      "invoices.view",
      "memberships.view",
      "attendance.view",
    ],
  },
};

const receptionist: SessionUser = {
  ...testUser,
  name: "Riya Reception",
  branchId: testBranches[0]!.id,
  role: {
    id: "role_r",
    name: "RECEPTIONIST",
    permissions: ["members.view", "invoices.view", "memberships.view", "attendance.view"],
  },
};

const trainer: SessionUser = {
  ...testUser,
  name: "Tara Trainer",
  branchId: testBranches[0]!.id,
  role: {
    id: "role_t",
    name: "TRAINER",
    permissions: ["members.view", "attendance.view"],
  },
};

function payload(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    asOf: "2026-09-07T08:00:00.000Z",
    timezone: "Asia/Kolkata",
    month: "2026-09",
    scope: { branchId: null, branchName: null },
    widgets: {
      members: { total: 42, active: 31 },
      revenue: {
        month: "2026-09",
        total: "18500.00",
        trend: [
          { month: "2026-04", total: "8000.00" },
          { month: "2026-05", total: "9100.00" },
          { month: "2026-06", total: "7600.00" },
          { month: "2026-07", total: "10200.00" },
          { month: "2026-08", total: "14000.00" },
          { month: "2026-09", total: "18500.00" },
        ],
      },
      outstanding: { amount: "2400.50", invoiceCount: 4 },
      expiring: {
        withinDays: 7,
        count: 2,
        items: [
          {
            membershipId: "01k4h0ms0000000000000001",
            memberId: "01k4h0member0000000000001",
            firstName: "Aarav",
            lastName: "Singh",
            phone: "+919000000001",
            planName: "Gold",
            endDate: "2026-09-10",
            daysRemaining: 3,
          },
          {
            membershipId: "01k4h0ms0000000000000002",
            memberId: "01k4h0member0000000000002",
            firstName: "Diya",
            lastName: "Shah",
            phone: "+919000000002",
            planName: "Silver",
            endDate: "2026-09-08",
            daysRemaining: 1,
          },
        ],
      },
      attendance: { date: "2026-09-07", count: 11 },
    },
    ...overrides,
  };
}

function renderDashboard(user: SessionUser = owner, branchId: string | null = null) {
  useSessionStore.getState().setSession({
    user: { ...user, branchId: user.branchId },
    organization: testOrganization,
    branches: testBranches,
  });
  useSessionStore.getState().setActiveBranch(branchId);
  return renderWithProviders(<DashboardPage />);
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
});

afterEach(() => {
  mock.restore();
});

describe("DashboardPage — widgets", () => {
  it("renders every number the API sent, formatted, not recomputed", async () => {
    mock.onGet(PATH).reply(200, { success: true, data: payload() });
    renderDashboard();

    expect(await screen.findByTestId("widget-members-value")).toHaveTextContent("42");
    expect(screen.getByTestId("widget-members")).toHaveTextContent("31 with cover today");
    expect(screen.getByTestId("widget-revenue-value")).toHaveTextContent("₹18,500.00");
    expect(screen.getByTestId("widget-outstanding-value")).toHaveTextContent("₹2,400.50");
    expect(screen.getByTestId("widget-attendance-value")).toHaveTextContent("11");
    expect(screen.getByTestId("widget-expiring")).toHaveTextContent("Aarav Singh");
    expect(screen.getByTestId("widget-expiring")).toHaveTextContent("tomorrow");
    expect(screen.getByTestId("stat-organization")).toHaveTextContent("Demo Gym");
  });

  it("keeps the Phase 3 session strip so a reload still has a heading to land on", async () => {
    mock.onGet(PATH).reply(200, { success: true, data: payload() });
    renderDashboard();

    expect(screen.getByTestId("dashboard-heading")).toHaveTextContent("Dashboard");
    expect(await screen.findByTestId("stat-role")).toHaveTextContent("OWNER");
  });

  it("omits widgets the payload does not include — a receptionist never sees revenue", async () => {
    mock.onGet(PATH).reply(200, {
      success: true,
      data: payload({
        scope: { branchId: testBranches[0]!.id, branchName: "Main Branch" },
        widgets: {
          members: { total: 12, active: 9 },
          outstanding: { amount: "400.00", invoiceCount: 1 },
          expiring: { withinDays: 7, count: 0, items: [] },
          attendance: { date: "2026-09-07", count: 3 },
        },
      }),
    });
    renderDashboard(receptionist, testBranches[0]!.id);

    expect(await screen.findByTestId("widget-members")).toBeInTheDocument();
    expect(screen.getByTestId("widget-outstanding")).toBeInTheDocument();
    expect(screen.getByTestId("widget-attendance")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-revenue")).not.toBeInTheDocument();
    expect(screen.queryByTestId("widget-revenue-trend")).not.toBeInTheDocument();
    expect(screen.getByTestId("stat-scope")).toHaveTextContent("Main Branch");
  });

  it("shows a trainer only the widgets their role can see", async () => {
    mock.onGet(PATH).reply(200, {
      success: true,
      data: payload({
        widgets: {
          members: { total: 12, active: 9 },
          attendance: { date: "2026-09-07", count: 3 },
        },
      }),
    });
    renderDashboard(trainer, testBranches[0]!.id);

    expect(await screen.findByTestId("widget-members")).toBeInTheDocument();
    expect(screen.getByTestId("widget-attendance")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-outstanding")).not.toBeInTheDocument();
    expect(screen.queryByTestId("widget-expiring")).not.toBeInTheDocument();
    expect(screen.queryByTestId("widget-revenue")).not.toBeInTheDocument();
  });

  it("passes the active branch so org-wide totals and a single branch are different requests", async () => {
    mock.onGet(PATH).reply(200, { success: true, data: payload() });
    renderDashboard(owner, testBranches[0]!.id);

    await waitFor(() => expect(mock.history.get.length).toBe(1));
    expect(mock.history.get[0]?.params).toEqual({ branchId: testBranches[0]!.id });
  });

  it("surfaces an API failure rather than showing last month's numbers", async () => {
    mock.onGet(PATH).reply(500, {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Dashboard query failed" },
    });
    renderDashboard();

    expect(await screen.findByRole("alert")).toHaveTextContent("Dashboard query failed");
    expect(screen.queryByTestId("widget-members")).not.toBeInTheDocument();
  });

  it("links the expiring list through to the member, not a dead row", async () => {
    mock.onGet(PATH).reply(200, { success: true, data: payload() });
    renderDashboard();

    const link = await screen.findByRole("link", { name: /Aarav Singh/ });
    expect(link).toHaveAttribute("href", "/members/01k4h0member0000000000001");
  });
});
