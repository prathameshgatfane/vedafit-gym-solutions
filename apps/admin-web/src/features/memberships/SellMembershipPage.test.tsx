import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SellMembershipPage } from "./SellMembershipPage";
import { apiClient } from "../../lib/api-client";
import { useSessionStore, type SessionUser } from "../../stores/session.store";
import {
  renderWithProviders,
  testBranches,
  testOrganization,
  testUser,
} from "../../test/test-utils";

let mock: MockAdapter;

const MEMBER_ID = "01k4h0member0000000000001";
const PLAN_ID = "01k4h0plan00000000000001";
const MEMBER_PATH = `/organizations/${testOrganization.id}/members/${MEMBER_ID}`;
const PLANS_PATH = `/organizations/${testOrganization.id}/membership-plans`;
const MEMBERSHIPS_PATH = `/organizations/${testOrganization.id}/memberships`;

const receptionist: SessionUser = {
  ...testUser,
  role: {
    id: "role_r",
    name: "RECEPTIONIST",
    permissions: ["members.view", "memberships.create", "membership-plans.view"],
  },
};

function renderSell() {
  useSessionStore.getState().setSession({
    user: receptionist,
    organization: testOrganization,
    branches: testBranches,
  });

  return renderWithProviders(
    <Routes>
      <Route path="/members/:memberId/memberships/new" element={<SellMembershipPage />} />
      <Route path="/memberships/:membershipId" element={<h1>Membership detail</h1>} />
    </Routes>,
    { route: `/members/${MEMBER_ID}/memberships/new` },
  );
}

function mockMemberAndPlans(plans: unknown[]) {
  mock.onGet(MEMBER_PATH).reply(200, {
    success: true,
    data: {
      id: MEMBER_ID,
      organizationId: testOrganization.id,
      branchId: testBranches[0]!.id,
      firstName: "Aarav",
      lastName: "Singh",
      phone: "+919000000001",
      email: null,
      dateOfBirth: null,
      status: "ACTIVE",
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
  });
  mock.onGet(PLANS_PATH).reply(200, {
    success: true,
    data: plans,
    pagination: { page: 1, limit: 100, total: plans.length, totalPages: 1 },
  });
}

const goldPlan = {
  id: PLAN_ID,
  name: "Gold — Monthly",
  price: "1500.00",
  durationDays: 30,
  status: "ACTIVE",
};

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
});

afterEach(() => {
  mock.restore();
});

describe("SellMembershipPage", () => {
  it("promises the price will be locked to the chosen plan", async () => {
    mockMemberAndPlans([goldPlan]);

    renderSell();
    await userEvent.selectOptions(await screen.findByLabelText("Plan"), PLAN_ID);

    const notice = screen.getByTestId("snapshot-notice");
    expect(notice).toHaveTextContent("₹1,500.00");
    expect(notice).toHaveTextContent(/won't affect it/i);
  });

  it("omits an empty start date so the API applies its own default", async () => {
    mockMemberAndPlans([goldPlan]);
    mock.onPost(MEMBERSHIPS_PATH).reply(201, {
      success: true,
      data: { id: "01k4h0membership000000001" },
    });

    renderSell();
    await userEvent.selectOptions(await screen.findByLabelText("Plan"), PLAN_ID);
    await userEvent.click(screen.getByRole("button", { name: "Create membership" }));

    await waitFor(() => {
      expect(mock.history.post).toHaveLength(1);
    });
    expect(JSON.parse(mock.history.post[0]!.data)).toEqual({
      memberId: MEMBER_ID,
      planId: PLAN_ID,
    });
  });

  it("refuses to submit without a plan", async () => {
    mockMemberAndPlans([goldPlan]);

    renderSell();
    await screen.findByLabelText("Plan");
    await userEvent.click(screen.getByRole("button", { name: "Create membership" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/choose a plan/i);
    expect(mock.history.post).toHaveLength(0);
  });

  it("surfaces the overlap error, which tells staff to renew instead", async () => {
    mockMemberAndPlans([goldPlan]);
    mock.onPost(MEMBERSHIPS_PATH).reply(409, {
      success: false,
      error: {
        code: "MEMBERSHIP_OVERLAP",
        message:
          "This member already has a membership running 2026-09-01 to 2026-09-30 — renew it instead of adding a second one",
      },
    });

    renderSell();
    await userEvent.selectOptions(await screen.findByLabelText("Plan"), PLAN_ID);
    await userEvent.click(screen.getByRole("button", { name: "Create membership" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/renew it instead/i);
  });

  it("explains itself when there is nothing sellable in the catalog", async () => {
    mockMemberAndPlans([]);

    renderSell();

    expect(await screen.findByText(/no active plans to sell/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create membership" })).toBeDisabled();
  });
});
