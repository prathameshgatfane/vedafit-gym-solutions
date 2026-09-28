import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { renderWithProviders, testPlatformUser } from "../../test/test-utils";
import { defaultEntitlementRows } from "./entitlement-catalog";
import { PlanFormPage } from "./PlanFormPage";

let mock: MockAdapter;

const existingPlan = {
  id: "plan_growth",
  code: "growth",
  name: "Growth",
  description: "Paid stub",
  priceMonthly: "0.00",
  priceYearly: "0.00",
  currency: "INR",
  trialDays: 14,
  isActive: true,
  organizationCount: 3,
  entitlements: defaultEntitlementRows().map((row) =>
    row.key === "members.max"
      ? { key: row.key, valueType: "UNLIMITED" as const, intValue: null, boolValue: null }
      : row,
  ),
};

function renderCreate() {
  useSessionStore.getState().setSession(testPlatformUser);
  return renderWithProviders(
    <Routes>
      <Route path="/plans/new" element={<PlanFormPage />} />
      <Route path="/plans" element={<h1>Plans list</h1>} />
    </Routes>,
    { route: "/plans/new" },
  );
}

function renderEdit() {
  useSessionStore.getState().setSession(testPlatformUser);
  return renderWithProviders(
    <Routes>
      <Route path="/plans/:planId" element={<PlanFormPage />} />
      <Route path="/plans" element={<h1>Plans list</h1>} />
    </Routes>,
    { route: "/plans/plan_growth" },
  );
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
});

afterEach(() => {
  mock.restore();
});

describe("PlanFormPage", () => {
  it("validates name, code, and prices before opening confirmation", async () => {
    const user = userEvent.setup();
    renderCreate();

    await user.clear(screen.getByLabelText("Monthly price"));
    await user.type(screen.getByLabelText("Monthly price"), "-10");
    await user.type(screen.getByLabelText("Code"), "1bad");
    await user.click(screen.getByTestId("review-plan"));

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(screen.getByText(/letter first/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be negative/i)).toBeInTheDocument();
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
  });

  it("uses typed entitlement controls and rejects a non-numeric limit", async () => {
    const user = userEvent.setup();
    renderCreate();

    expect(screen.getByTestId("entitlement-editor")).toBeInTheDocument();
    expect(screen.getByText("Maximum members")).toBeInTheDocument();
    expect(screen.getByText("Leads and CRM")).toBeInTheDocument();
    expect(screen.queryByLabelText(/foo\.bar/i)).not.toBeInTheDocument();

    const limit = screen.getAllByLabelText("Limit")[0]!;
    await user.clear(limit);
    await user.type(limit, "abc");
    await user.type(screen.getByLabelText("Name"), "Custom");
    await user.type(screen.getByLabelText("Code"), "custom");
    await user.click(screen.getByTestId("review-plan"));

    expect(await screen.findByText(/whole number/i)).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
  });

  it("shows confirmation, then creates a plan with allowlisted entitlements", async () => {
    const user = userEvent.setup();
    mock.onPost("/platform/plans").reply(201, {
      success: true,
      data: { ...existingPlan, id: "plan_new", code: "custom", name: "Custom" },
    });

    renderCreate();
    await user.type(screen.getByLabelText("Name"), "Custom");
    await user.type(screen.getByLabelText("Code"), "custom");
    await user.selectOptions(screen.getAllByLabelText("Access")[0]!, "false");
    await user.click(screen.getByTestId("review-plan"));

    expect(await screen.findByTestId("confirm-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("plan-impact")).toHaveTextContent("Custom (custom)");
    expect(mock.history.post).toHaveLength(0);

    await user.click(screen.getByTestId("confirm-accept"));
    expect(await screen.findByRole("heading", { name: "Plans list" })).toBeInTheDocument();

    const body = JSON.parse(mock.history.post[0]?.data ?? "{}") as {
      code: string;
      entitlements: Array<{ key: string; valueType: string; boolValue?: boolean }>;
    };
    expect(body.code).toBe("custom");
    expect(body.entitlements.map((row) => row.key).sort()).toEqual(
      defaultEntitlementRows()
        .map((row) => row.key)
        .sort(),
    );
    expect(body.entitlements.find((row) => row.key === "leads")).toMatchObject({
      valueType: "BOOLEAN",
      boolValue: false,
    });
    expect(body.entitlements.some((row) => row.key === "foo.bar")).toBe(false);
  });

  it("warns that existing organizations pick up edit changes immediately", async () => {
    const user = userEvent.setup();
    mock.onGet("/platform/plans/plan_growth").reply(200, { success: true, data: existingPlan });
    mock.onPatch("/platform/plans/plan_growth").reply(200, {
      success: true,
      data: { ...existingPlan, name: "Growth Plus" },
    });

    renderEdit();
    expect(await screen.findByDisplayValue("Growth")).toBeInTheDocument();
    expect(screen.getByLabelText("Code")).toBeDisabled();

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Growth Plus");
    await user.click(screen.getByTestId("review-plan"));

    expect(await screen.findByTestId("plan-impact")).toHaveTextContent(
      "3 organizations currently on this plan will receive the new limits immediately",
    );
    expect(screen.getByText(/Growth → Growth Plus|name: Growth → Growth Plus/)).toBeInTheDocument();

    await user.click(screen.getByTestId("confirm-accept"));
    expect(await screen.findByRole("heading", { name: "Plans list" })).toBeInTheDocument();

    const body = JSON.parse(mock.history.patch[0]?.data ?? "{}") as Record<string, unknown>;
    expect(body).toMatchObject({ name: "Growth Plus" });
    expect(body).not.toHaveProperty("code");
    expect(body).not.toHaveProperty("planId");
    expect(body).not.toHaveProperty("organizationId");
  });

  it("shows API errors after a failed create", async () => {
    const user = userEvent.setup();
    mock.onPost("/platform/plans").reply(409, {
      success: false,
      error: { code: "DUPLICATE_SAAS_PLAN_CODE", message: "A SaaS plan with code \"custom\" already exists" },
    });

    renderCreate();
    await user.type(screen.getByLabelText("Name"), "Custom");
    await user.type(screen.getByLabelText("Code"), "custom");
    await user.click(screen.getByTestId("review-plan"));
    await user.click(await screen.findByTestId("confirm-accept"));

    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
  });
});
