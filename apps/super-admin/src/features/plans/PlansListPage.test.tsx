import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { renderWithProviders, testPlatformUser } from "../../test/test-utils";
import { defaultEntitlementRows } from "./entitlement-catalog";
import { PlansListPage } from "./PlansListPage";

let mock: MockAdapter;

const trialPlan = {
  id: "plan_trial",
  code: "trial",
  name: "Trial",
  description: "Default signup",
  priceMonthly: "0.00",
  priceYearly: "0.00",
  currency: "INR",
  trialDays: 14,
  isActive: true,
  organizationCount: 2,
  entitlements: defaultEntitlementRows().map((row) =>
    row.key === "members.max" ? { ...row, intValue: 50 } : row,
  ),
};

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().setSession(testPlatformUser);
});

afterEach(() => {
  mock.restore();
  useSessionStore.getState().clear();
});

describe("PlansListPage", () => {
  it("renders catalog cards with labels, org count, and management actions", async () => {
    mock.onGet("/platform/plans").reply(200, { success: true, data: [trialPlan] });

    renderWithProviders(<PlansListPage />);

    expect(await screen.findByText("Trial")).toBeInTheDocument();
    expect(screen.getByText("Maximum members")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText("2 organizations")).toBeInTheDocument();
    expect(screen.getByTestId("create-plan")).toBeInTheDocument();
    expect(screen.getByTestId("edit-plan")).toBeInTheDocument();
    expect(screen.getByTestId("archive-plan")).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    mock.onGet("/platform/plans").reply(200, { success: true, data: [] });
    renderWithProviders(<PlansListPage />);
    expect(await screen.findByText("No SaaS plans in the catalog.")).toBeInTheDocument();
  });

  it("shows an API error on load", async () => {
    mock.onGet("/platform/plans").reply(500, {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Catalog unavailable" },
    });
    renderWithProviders(<PlansListPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Catalog unavailable");
  });

  it("confirms archive before calling the API and shows API errors", async () => {
    const user = userEvent.setup();
    mock.onGet("/platform/plans").reply(200, { success: true, data: [trialPlan] });
    mock.onPost("/platform/plans/plan_trial/archive").reply(409, {
      success: false,
      error: { code: "SAAS_PLAN_INACTIVE", message: "Could not archive Trial." },
    });

    renderWithProviders(<PlansListPage />);
    await user.click(await screen.findByTestId("archive-plan"));
    expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
    expect(screen.getByText(/cannot be assigned to new organizations/i)).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);

    await user.click(screen.getByTestId("confirm-accept"));
    expect(await screen.findByText("Could not archive Trial.")).toBeInTheDocument();
    expect(mock.history.post[0]?.url).toBe("/platform/plans/plan_trial/archive");
  });

  it("activates an archived plan after confirmation", async () => {
    const user = userEvent.setup();
    mock.onGet("/platform/plans").reply(200, {
      success: true,
      data: [{ ...trialPlan, isActive: false }],
    });
    mock.onPost("/platform/plans/plan_trial/activate").reply(200, {
      success: true,
      data: trialPlan,
    });

    renderWithProviders(<PlansListPage />);
    await user.click(await screen.findByTestId("activate-plan"));
    await user.click(screen.getByTestId("confirm-accept"));
    expect(mock.history.post[0]?.url).toBe("/platform/plans/plan_trial/activate");
  });
});
