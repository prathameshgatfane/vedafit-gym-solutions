import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { renderWithProviders, testPlatformUser } from "../../test/test-utils";
import { OrganizationDetailPage } from "./OrganizationDetailPage";
import type { OrganizationDetail } from "./organization.types";

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
    { key: "leads.manage", valueType: "BOOLEAN", intValue: null, boolValue: true },
  ],
};

const plans = [
  {
    id: "plan_growth",
    code: "growth",
    name: "Growth",
    description: null,
    priceMonthly: "0.00",
    priceYearly: "0.00",
    currency: "INR",
    trialDays: 14,
    isActive: true,
    entitlements: [],
  },
  {
    id: "plan_starter",
    code: "starter",
    name: "Starter",
    description: null,
    priceMonthly: "0.00",
    priceYearly: "0.00",
    currency: "INR",
    trialDays: 14,
    isActive: true,
    entitlements: [],
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
    expect(screen.getByText("members.max")).toBeInTheDocument();
    expect(screen.getByText("Unlimited")).toBeInTheDocument();
    expect(screen.queryByLabelText(/entitlement/i)).not.toBeInTheDocument();
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

  it("confirms before assigning a plan and does not send entitlement values", async () => {
    const user = userEvent.setup();
    mock.onPatch("/platform/organizations/org_demo/subscription").reply(200, {
      success: true,
      data: {
        organization: { id: "org_demo", status: "ACTIVE" },
        subscription: { ...detail.subscription, plan: plans[1] },
      },
    });

    renderDetail();
    await screen.findByRole("heading", { name: "Demo Gym" });

    await user.selectOptions(screen.getByLabelText(/saas plan/i), "plan_starter");
    await user.click(screen.getByRole("button", { name: /review subscription change/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Apply subscription change?");

    await user.click(screen.getByRole("button", { name: "Apply change" }));

    await waitFor(() => {
      expect(mock.history.patch.some((call) => call.url?.endsWith("/subscription"))).toBe(true);
    });
    const body = JSON.parse(
      mock.history.patch.find((call) => call.url?.endsWith("/subscription"))?.data ?? "{}",
    ) as Record<string, unknown>;
    expect(body.planId).toBe("plan_starter");
    expect(body).not.toHaveProperty("organizationId");
    expect(body).not.toHaveProperty("entitlements");
    expect(body).not.toHaveProperty("members.max");
  });

  it("surfaces a missing organization as an error", async () => {
    mock.onGet("/platform/organizations/org_demo").reply(404, {
      success: false,
      error: { code: "ORGANIZATION_NOT_FOUND", message: 'Organization "org_demo" not found' },
    });

    renderDetail();

    expect(await screen.findByRole("alert")).toHaveTextContent("not found");
  });
});
