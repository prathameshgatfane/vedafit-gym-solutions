import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../lib/api-client";
import { copyText } from "../../lib/clipboard";
import { useSessionStore } from "../../stores/session.store";
import { renderWithProviders, testPlatformUser } from "../../test/test-utils";
import { defaultEntitlementRows } from "../plans/entitlement-catalog";
import { OrganizationFormPage } from "./OrganizationFormPage";

vi.mock("../../lib/clipboard", () => ({
  copyText: vi.fn(),
}));

let mock: MockAdapter;
const copyTextMock = vi.mocked(copyText);

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
  entitlements: defaultEntitlementRows(),
};

const growthPlan = {
  id: "plan_growth",
  code: "growth",
  name: "Growth",
  description: "Paid catalog",
  priceMonthly: "1999.00",
  priceYearly: "19990.00",
  currency: "INR",
  trialDays: 0,
  isActive: true,
  entitlements: defaultEntitlementRows().map((row) =>
    row.key === "members.max" ? { ...row, valueType: "UNLIMITED" as const, intValue: null } : row,
  ),
};

const archivedPlan = {
  id: "plan_old",
  code: "old",
  name: "Old",
  description: "Archived",
  priceMonthly: "1.00",
  priceYearly: "10.00",
  currency: "INR",
  trialDays: 0,
  isActive: false,
  entitlements: defaultEntitlementRows(),
};

const createdPayload = {
  organization: {
    id: "org_new",
    name: "Acme Gym",
    slug: "acme-gym",
    email: "hello@acme.test",
    phone: null,
    status: "ACTIVE",
    timezone: "Asia/Kolkata",
  },
  branch: { id: "br_1", name: "Main" },
  owner: { id: "u_1", name: "Ada Owner", email: "ada@acme.test" },
  subscription: { id: "sub_1", planCode: "growth", status: "ACTIVE" },
};

function renderForm() {
  useSessionStore.getState().setSession(testPlatformUser);
  return renderWithProviders(
    <Routes>
      <Route path="/organizations/new" element={<OrganizationFormPage />} />
      <Route path="/organizations/:organizationId" element={<h1>Created org</h1>} />
    </Routes>,
    { route: "/organizations/new" },
  );
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  mock.onGet("/platform/plans").reply(200, {
    success: true,
    data: [trialPlan, growthPlan, archivedPlan],
  });
  copyTextMock.mockReset();
  copyTextMock.mockResolvedValue(true);
  useSessionStore.getState().clear();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  mock.restore();
});

async function fillGym(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Organization name"), "Acme Gym");
  await user.type(screen.getByLabelText("Slug"), "acme-gym");
  await user.type(screen.getByLabelText("Organization email"), "hello@acme.test");
  await user.type(screen.getByLabelText("Owner name"), "Ada Owner");
  await user.type(screen.getByLabelText("Owner email"), "ada@acme.test");
}

async function chooseGrowth(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByLabelText("SaaS plan"), "plan_growth");
  await user.selectOptions(screen.getByLabelText("Subscription status"), "ACTIVE");
  await user.selectOptions(screen.getByLabelText("Billing interval"), "YEARLY");
}

describe("OrganizationFormPage", () => {
  it("defaults to generate mode and shows a one-time password panel", async () => {
    const user = userEvent.setup();
    mock.onPost("/platform/organizations").reply(201, {
      success: true,
      data: {
        ...createdPayload,
        credentials: { email: "ada@acme.test", temporaryPassword: "TempPass12" },
      },
    });

    renderForm();
    expect(screen.getByTestId("credential-mode-generate")).toBeChecked();
    expect(screen.queryByLabelText("Owner password")).not.toBeInTheDocument();

    await fillGym(user);
    await chooseGrowth(user);
    await user.click(screen.getByRole("button", { name: /create organization/i }));

    expect(await screen.findByTestId("org-credentials-panel")).toBeInTheDocument();
    expect(screen.getByTestId("credentials-email")).toHaveTextContent("ada@acme.test");
    expect(screen.getByTestId("credentials-plan")).toHaveTextContent("Growth (growth)");
    expect(screen.getByTestId("credentials-status")).toHaveTextContent("ACTIVE");
    expect(screen.getByTestId("credentials-billing")).toHaveTextContent("YEARLY");
    expect(screen.getByTestId("credentials-temp-password")).toHaveTextContent("TempPass12");
    expect(screen.queryByRole("heading", { name: "Created org" })).not.toBeInTheDocument();

    const body = JSON.parse(mock.history.post[0]?.data ?? "{}") as Record<string, unknown>;
    expect(body).toMatchObject({
      generatePassword: true,
      planId: "plan_growth",
      owner: { name: "Ada Owner", email: "ada@acme.test" },
    });
    expect(body.owner).not.toHaveProperty("password");
    expect(JSON.stringify(useSessionStore.getState())).not.toMatch(/TempPass12|temporaryPassword/);
    expect(localStorage.getItem("TempPass12")).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it("copies the temporary password and then continues without a warning", async () => {
    const user = userEvent.setup();
    mock.onPost("/platform/organizations").reply(201, {
      success: true,
      data: {
        ...createdPayload,
        credentials: { email: "ada@acme.test", temporaryPassword: "TempPass12" },
      },
    });

    renderForm();
    await fillGym(user);
    await chooseGrowth(user);
    await user.click(screen.getByRole("button", { name: /create organization/i }));
    await user.click(await screen.findByTestId("credentials-copy"));

    expect(copyTextMock).toHaveBeenCalledWith("TempPass12");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();

    await user.click(screen.getByTestId("credentials-continue"));
    expect(await screen.findByRole("heading", { name: "Created org" })).toBeInTheDocument();
    expect(screen.queryByText("TempPass12")).not.toBeInTheDocument();
    expect(screen.queryByTestId("org-credentials-panel")).not.toBeInTheDocument();
  });

  it("shows a clipboard fallback and warns before closing an uncopied password", async () => {
    const user = userEvent.setup();
    copyTextMock.mockResolvedValue(false);
    mock.onPost("/platform/organizations").reply(201, {
      success: true,
      data: {
        ...createdPayload,
        credentials: { email: "ada@acme.test", temporaryPassword: "TempPass12" },
      },
    });

    renderForm();
    await fillGym(user);
    await chooseGrowth(user);
    await user.click(screen.getByRole("button", { name: /create organization/i }));
    await user.click(await screen.findByTestId("credentials-copy"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not copy/i);
    await user.click(screen.getByTestId("credentials-continue"));
    expect(screen.getByTestId("confirm-dialog")).toHaveTextContent(/will not be shown again/i);
    await user.click(screen.getByTestId("confirm-accept"));

    expect(await screen.findByRole("heading", { name: "Created org" })).toBeInTheDocument();
    expect(screen.queryByText("TempPass12")).not.toBeInTheDocument();
  });

  it("creates with a manual password and does not echo it", async () => {
    const user = userEvent.setup();
    mock.onPost("/platform/organizations").reply(201, {
      success: true,
      data: createdPayload,
    });

    renderForm();
    await fillGym(user);
    await user.click(screen.getByTestId("credential-mode-manual"));
    await user.type(screen.getByLabelText("Owner password"), "ChangeMe123!");
    await user.type(screen.getByLabelText("Confirm owner password"), "ChangeMe123!");
    await chooseGrowth(user);
    await user.click(screen.getByRole("button", { name: /create organization/i }));

    expect(await screen.findByTestId("org-credentials-panel")).toBeInTheDocument();
    expect(screen.getByTestId("credentials-temp-password")).toHaveTextContent("Set by administrator");
    expect(screen.queryByText("ChangeMe123!")).not.toBeInTheDocument();
    expect(screen.queryByTestId("credentials-copy")).not.toBeInTheDocument();

    const body = JSON.parse(mock.history.post[0]?.data ?? "{}") as {
      generatePassword: boolean;
      owner: Record<string, unknown>;
    };
    expect(body.generatePassword).toBe(false);
    expect(body.owner.password).toBe("ChangeMe123!");

    await user.click(screen.getByTestId("credentials-continue"));
    expect(await screen.findByRole("heading", { name: "Created org" })).toBeInTheDocument();
  });

  it("rejects a password mismatch and a weak password before calling the API", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillGym(user);
    await user.click(screen.getByTestId("credential-mode-manual"));
    await user.type(screen.getByLabelText("Owner password"), "ChangeMe123!");
    await user.type(screen.getByLabelText("Confirm owner password"), "ChangeMe124!");
    await user.selectOptions(await screen.findByLabelText("SaaS plan"), "plan_trial");
    await user.click(screen.getByRole("button", { name: /create organization/i }));
    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);

    await user.clear(screen.getByLabelText("Owner password"));
    await user.clear(screen.getByLabelText("Confirm owner password"));
    await user.type(screen.getByLabelText("Owner password"), "password");
    await user.type(screen.getByLabelText("Confirm owner password"), "password");
    await user.click(screen.getByRole("button", { name: /create organization/i }));
    expect(await screen.findByText(/uppercase letter/i)).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
  });

  it("does not show a credential panel when create fails", async () => {
    const user = userEvent.setup();
    mock.onPost("/platform/organizations").reply(409, {
      success: false,
      error: { code: "DUPLICATE_ORGANIZATION_SLUG", message: "Slug taken" },
    });

    renderForm();
    await fillGym(user);
    await chooseGrowth(user);
    await user.click(screen.getByRole("button", { name: /create organization/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Slug taken");
    expect(screen.queryByTestId("org-credentials-panel")).not.toBeInTheDocument();
    expect(screen.queryByText("TempPass12")).not.toBeInTheDocument();
  });

  it("previews the selected plan and hides archived plans", async () => {
    const user = userEvent.setup();
    renderForm();

    const planSelect = await screen.findByLabelText("SaaS plan");
    expect(await screen.findByRole("option", { name: "Growth (growth)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Old (old)" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("plan-preview")).not.toBeInTheDocument();

    await user.selectOptions(planSelect, "plan_growth");
    const preview = await screen.findByTestId("plan-preview");
    expect(preview).toHaveTextContent("Growth (growth)");
    expect(preview).toHaveTextContent("Maximum members");
    expect(preview).toHaveTextContent("Unlimited");
    expect(preview).toHaveTextContent("₹1,999.00");
    expect(screen.queryByLabelText(/entitlement/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/price monthly/i)).not.toBeInTheDocument();
  });
});
