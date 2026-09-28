import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { renderWithProviders, testPlatformUser } from "../../test/test-utils";
import { OrganizationDetailPage } from "./OrganizationDetailPage";
import type { OrganizationDetail, OrganizationUsage } from "./organization.types";

let mock: MockAdapter;

const detail: OrganizationDetail = {
  organization: {
    id: "org_demo",
    name: "Demo Gym",
    slug: "demo-gym",
    email: "hello@demo-gym.test",
    phone: "+911234567890",
    status: "ACTIVE",
    timezone: "Asia/Kolkata",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  },
  owner: { email: "owner@demo-gym.test" },
  subscription: {
    id: "sub_1",
    status: "ACTIVE",
    billingInterval: "MONTHLY",
    priceSnapshot: "0.00",
    currentPeriodStart: "2026-09-01T00:00:00.000Z",
    currentPeriodEnd: "2026-10-01T00:00:00.000Z",
    plan: { id: "plan_growth", code: "growth", name: "Growth" },
  },
  entitlements: [
    { key: "members.max", valueType: "UNLIMITED", intValue: null, boolValue: null },
    { key: "branches.max", valueType: "LIMIT", intValue: 5, boolValue: null },
    { key: "staff.max", valueType: "UNLIMITED", intValue: null, boolValue: null },
    { key: "leads", valueType: "BOOLEAN", intValue: null, boolValue: true },
    { key: "trainers", valueType: "BOOLEAN", intValue: null, boolValue: true },
    { key: "reports.enabled", valueType: "BOOLEAN", intValue: null, boolValue: true },
    { key: "notifications.enabled", valueType: "BOOLEAN", intValue: null, boolValue: true },
    { key: "whatsapp.enabled", valueType: "BOOLEAN", intValue: null, boolValue: false },
    { key: "online_payments.enabled", valueType: "BOOLEAN", intValue: null, boolValue: false },
  ],
};

const unavailable = { available: false as const, reason: "NO_CONSUMPTION_PATH" };

function usagePayload(overrides: Partial<OrganizationUsage["usage"]> = {}): OrganizationUsage {
  return {
    organization: { id: "org_demo", name: "Demo Gym", slug: "demo-gym" },
    subscription: {
      id: "sub_1",
      status: "ACTIVE",
      billingInterval: "MONTHLY",
      plan: { id: "plan_growth", code: "growth", name: "Growth" },
    },
    usage: {
      members: { used: 137, limit: null, unlimited: true, remaining: null, overLimit: false },
      branches: { used: 1, limit: 5, unlimited: false, remaining: 4, overLimit: false },
      staff: { used: 5, limit: null, unlimited: true, remaining: null, overLimit: false },
      trainers: { used: 12, limit: null, unlimited: false, remaining: null, overLimit: false },
      leads: { used: 34, limit: null, unlimited: false, remaining: null, overLimit: false },
      storage: unavailable,
      monthlySms: unavailable,
      whatsapp: unavailable,
      onlinePayments: unavailable,
      ...overrides,
    },
    features: {
      leads: { enabled: true },
      trainers: { enabled: true },
      reports: { enabled: true },
      notifications: { enabled: true },
      whatsapp: { enabled: false },
      onlinePayments: { enabled: false },
    },
  };
}

const plans = [
  {
    id: "plan_growth",
    code: "growth",
    name: "Growth",
    description: null,
    priceMonthly: "0.00",
    priceYearly: "999.00",
    currency: "INR",
    trialDays: 14,
    isActive: true,
    entitlements: [
      { key: "members.max", valueType: "UNLIMITED", intValue: null, boolValue: null },
      { key: "branches.max", valueType: "LIMIT", intValue: 5, boolValue: null },
      { key: "staff.max", valueType: "UNLIMITED", intValue: null, boolValue: null },
      { key: "leads", valueType: "BOOLEAN", intValue: null, boolValue: true },
    ],
  },
  {
    id: "plan_starter",
    code: "starter",
    name: "Starter",
    description: null,
    priceMonthly: "499.00",
    priceYearly: "4990.00",
    currency: "INR",
    trialDays: 14,
    isActive: true,
    entitlements: [
      { key: "members.max", valueType: "LIMIT", intValue: 50, boolValue: null },
      { key: "branches.max", valueType: "LIMIT", intValue: 1, boolValue: null },
      { key: "staff.max", valueType: "LIMIT", intValue: 3, boolValue: null },
      { key: "leads", valueType: "BOOLEAN", intValue: null, boolValue: false },
    ],
  },
];

function renderDetail() {
  useSessionStore.getState().setSession(testPlatformUser);
  return renderWithProviders(
    <Routes>
      <Route path="/organizations/:organizationId" element={<OrganizationDetailPage />} />
    </Routes>,
    { route: "/organizations/org_demo" },
  );
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
  mock.onGet("/platform/organizations/org_demo").reply(200, { success: true, data: detail });
  mock.onGet("/platform/organizations/org_demo/usage").reply(200, {
    success: true,
    data: usagePayload(),
  });
  mock.onGet("/platform/plans").reply(200, { success: true, data: plans });
});

afterEach(() => {
  mock.restore();
});

describe("OrganizationDetailPage", () => {
  it("renders organization, owner, subscription, and read-only entitlements", async () => {
    renderDetail();

    expect(await screen.findByRole("heading", { name: "Demo Gym" })).toBeInTheDocument();
    expect(screen.getByText("owner@demo-gym.test")).toBeInTheDocument();
    expect(screen.getAllByText("Growth (growth)").length).toBeGreaterThan(0);
    expect(screen.getByText("MONTHLY")).toBeInTheDocument();
    expect(screen.getByTestId("entitlements-section")).toHaveTextContent("Maximum members");
    expect(screen.getByTestId("entitlements-section")).toHaveTextContent("Unlimited");
    expect(screen.getByTestId("entitlements-section")).toHaveTextContent("Leads and CRM");
    expect(screen.getByTestId("entitlements-section")).toHaveTextContent("Enabled");
    expect(screen.queryByLabelText(/entitlement/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/temporary password/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/passwordHash|temporaryPassword|accessToken/);
  });

  it("requests usage for the detail page and renders limits, observational counts, and features", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "Demo Gym" });

    await waitFor(() => {
      expect(
        mock.history.get.some((call) => call.url === "/platform/organizations/org_demo/usage"),
      ).toBe(true);
    });

    expect(screen.getByTestId("usage-members")).toHaveTextContent("Used: 137");
    expect(screen.getByTestId("usage-members")).toHaveTextContent("Limit: Unlimited");
    expect(screen.getByTestId("usage-branches")).toHaveTextContent("1 / 5");
    expect(screen.getByTestId("usage-branches")).toHaveTextContent("4 remaining");
    expect(screen.getByTestId("usage-staff")).toHaveTextContent("Used: 5");
    expect(screen.getByTestId("usage-trainers")).toHaveTextContent("12 created");
    expect(screen.getByTestId("usage-trainers")).toHaveTextContent("Feature: Enabled");
    expect(screen.getByTestId("usage-leads")).toHaveTextContent("34 created");
    expect(screen.getByTestId("usage-storage")).toHaveTextContent("Unavailable");
    expect(screen.getByTestId("usage-storage")).toHaveTextContent("No consumption path currently implemented.");
    expect(screen.getByTestId("usage-storage")).not.toHaveTextContent("0");
    expect(screen.getByTestId("usage-monthlySms")).not.toHaveTextContent("0 SMS");
    expect(screen.getByTestId("feature-reports")).toHaveTextContent("Enabled");
    expect(screen.getByTestId("feature-whatsapp")).toHaveTextContent("Disabled");
    expect(screen.getByTestId("feature-onlinePayments")).toHaveTextContent("Disabled");
  });

  it("renders over-limit usage without treating it as a delete action", async () => {
    mock.onGet("/platform/organizations/org_demo/usage").reply(200, {
      success: true,
      data: usagePayload({
        members: { used: 137, limit: 50, unlimited: false, remaining: 0, overLimit: true },
      }),
    });

    renderDetail();
    expect(await screen.findByTestId("usage-members")).toHaveTextContent("137 / 50");
    expect(screen.getByTestId("usage-members")).toHaveTextContent("Over limit by 87");
    expect(screen.getByTestId("usage-over-limit-note")).toHaveTextContent(
      "Existing records are retained. Plan enforcement prevents additional usage where applicable.",
    );
  });

  it("shows a usage loading state without placeholder zeros", async () => {
    mock.onGet("/platform/organizations/org_demo/usage").reply(() => new Promise(() => undefined));
    renderDetail();
    await screen.findByRole("heading", { name: "Demo Gym" });
    expect(await screen.findByTestId("usage-loading")).toHaveTextContent("Loading usage…");
    expect(screen.queryByTestId("usage-members")).not.toBeInTheDocument();
    expect(screen.getByTestId("usage-section")).not.toHaveTextContent("0 / 0");
  });

  it("surfaces a usage API failure without inventing counts", async () => {
    mock.onGet("/platform/organizations/org_demo/usage").reply(403, {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Platform token required" },
    });
    renderDetail();
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((node) => node.textContent?.includes("Platform token required"))).toBe(true);
    expect(screen.queryByTestId("usage-members")).not.toBeInTheDocument();
  });

  it("confirms before suspending and sends only the status field", async () => {
    const user = userEvent.setup();
    mock.onPatch("/platform/organizations/org_demo/status").reply(200, {
      success: true,
      data: { id: "org_demo", status: "SUSPENDED" },
    });

    renderDetail();
    await screen.findByRole("heading", { name: "Demo Gym" });

    await user.click(screen.getByRole("button", { name: /suspend organization/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Suspend this organization?");

    await user.click(screen.getByRole("button", { name: "Suspend" }));

    await waitFor(() => {
      expect(mock.history.patch.some((call) => call.url?.endsWith("/status"))).toBe(true);
    });
    const body = JSON.parse(
      mock.history.patch.find((call) => call.url?.endsWith("/status"))?.data ?? "{}",
    ) as Record<string, unknown>;
    expect(body).toEqual({ status: "SUSPENDED" });
    expect(body).not.toHaveProperty("organizationId");
    expect(body).not.toHaveProperty("planId");
  });

  it("confirms current vs new values and entitlement impact before assigning a plan", async () => {
    const user = userEvent.setup();
    let currentDetail = detail;
    let currentUsage = usagePayload();
    mock.onGet("/platform/organizations/org_demo").reply(() => [
      200,
      { success: true, data: currentDetail },
    ]);
    mock.onGet("/platform/organizations/org_demo/usage").reply(() => [
      200,
      { success: true, data: currentUsage },
    ]);
    mock.onPatch("/platform/organizations/org_demo/subscription").reply(() => {
      currentDetail = {
        ...detail,
        subscription: {
          ...detail.subscription!,
          billingInterval: "YEARLY",
          plan: { id: "plan_starter", code: "starter", name: "Starter" },
        },
        entitlements: [
          { key: "members.max", valueType: "LIMIT", intValue: 50, boolValue: null },
          { key: "branches.max", valueType: "LIMIT", intValue: 1, boolValue: null },
          { key: "staff.max", valueType: "LIMIT", intValue: 3, boolValue: null },
          { key: "leads", valueType: "BOOLEAN", intValue: null, boolValue: false },
          { key: "trainers", valueType: "BOOLEAN", intValue: null, boolValue: false },
        ],
      };
      currentUsage = usagePayload({
        members: { used: 137, limit: 50, unlimited: false, remaining: 0, overLimit: true },
      });
      return [
        200,
        {
          success: true,
          data: {
            organization: { id: "org_demo", status: "ACTIVE" },
            subscription: currentDetail.subscription,
          },
        },
      ];
    });

    renderDetail();
    await screen.findByRole("heading", { name: "Demo Gym" });

    await user.selectOptions(screen.getByLabelText(/saas plan/i), "plan_starter");
    await user.selectOptions(screen.getByLabelText(/billing interval/i), "YEARLY");
    await user.click(screen.getByRole("button", { name: /review subscription change/i }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Apply subscription change?");
    expect(dialog).toHaveTextContent("Organization");
    expect(dialog).toHaveTextContent("Demo Gym");
    expect(dialog).toHaveTextContent("CURRENT");
    expect(dialog).toHaveTextContent("NEW");
    expect(dialog).toHaveTextContent("Growth (growth)");
    expect(dialog).toHaveTextContent("Starter (starter)");
    expect(dialog).toHaveTextContent("MONTHLY");
    expect(dialog).toHaveTextContent("YEARLY");
    expect(dialog).toHaveTextContent("₹0.00");
    expect(dialog).toHaveTextContent("₹4,990.00");
    expect(dialog).toHaveTextContent("Members");
    expect(dialog).toHaveTextContent("Unlimited → 50");
    expect(dialog).toHaveTextContent("Branches");
    expect(dialog).toHaveTextContent("5 → 1");
    expect(dialog).toHaveTextContent("Staff");
    expect(dialog).toHaveTextContent("Unlimited → 3");
    expect(dialog).toHaveTextContent("Leads");
    expect(dialog).toHaveTextContent("Enabled → Disabled");
    expect(dialog).toHaveTextContent("Plan entitlements take effect immediately.");
    expect(dialog).toHaveTextContent(
      "Gym payments, invoices, memberships, and owner credentials are not changed.",
    );

    await user.click(screen.getByRole("button", { name: "Apply change" }));

    await waitFor(() => {
      expect(mock.history.patch.some((call) => call.url?.endsWith("/subscription"))).toBe(true);
    });
    const body = JSON.parse(
      mock.history.patch.find((call) => call.url?.endsWith("/subscription"))?.data ?? "{}",
    ) as Record<string, unknown>;
    expect(body).toEqual({
      planId: "plan_starter",
      status: "ACTIVE",
      billingInterval: "YEARLY",
    });
    expect(body).not.toHaveProperty("organizationId");
    expect(body).not.toHaveProperty("entitlements");
    expect(body).not.toHaveProperty("priceSnapshot");
    expect(body).not.toHaveProperty("members.max");

    await waitFor(() => {
      expect(screen.getByTestId("entitlements-section")).toHaveTextContent("50");
      expect(screen.getByTestId("entitlements-section")).toHaveTextContent("Disabled");
      expect(screen.getByTestId("usage-members")).toHaveTextContent("137 / 50");
    });
    expect(
      mock.history.get.filter((call) => call.url === "/platform/organizations/org_demo/usage")
        .length,
    ).toBeGreaterThan(1);
    expect(
      mock.history.get.filter((call) => call.url === "/platform/organizations/org_demo").length,
    ).toBeGreaterThan(1);
  });

  it("surfaces a missing organization as an error", async () => {
    mock.onGet("/platform/organizations/org_demo").reply(404, {
      success: false,
      error: { code: "ORGANIZATION_NOT_FOUND", message: 'Organization "org_demo" not found' },
    });

    renderDetail();

    expect(await screen.findByRole("alert")).toHaveTextContent("not found");
    expect(mock.history.get.some((call) => call.url?.includes("/usage"))).toBe(false);
  });
});
