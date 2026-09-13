import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MembershipDetailPage } from "./MembershipDetailPage";
import { apiClient } from "../../lib/api-client";
import { useSessionStore, type SessionUser } from "../../stores/session.store";
import {
  renderWithProviders,
  testBranches,
  testOrganization,
  testUser,
} from "../../test/test-utils";
import type { Membership, MembershipStatus } from "./membership.types";

let mock: MockAdapter;

const MEMBERSHIP_ID = "01k4h0membership000000001";
const PLAN_ID = "01k4h0plan00000000000001";
const OTHER_PLAN_ID = "01k4h0plan00000000000002";
const DETAIL_PATH = `/organizations/${testOrganization.id}/memberships/${MEMBERSHIP_ID}`;
const PLANS_PATH = `/organizations/${testOrganization.id}/membership-plans`;

function membership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: MEMBERSHIP_ID,
    organizationId: testOrganization.id,
    branchId: testBranches[0]!.id,
    memberId: "01k4h0member0000000000001",
    planId: PLAN_ID,
    priceAtPurchase: "1500.00",
    durationDaysAtPurchase: 30,
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    status: "ACTIVE",
    frozenAt: null,
    totalFrozenDays: 0,
    previousMembershipId: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    isUpcoming: false,
    daysRemaining: 12,
    member: {
      id: "01k4h0member0000000000001",
      firstName: "Aarav",
      lastName: "Singh",
      phone: "+919000000001",
    },
    plan: { id: PLAN_ID, name: "Gold — Monthly", status: "ACTIVE" },
    ...overrides,
  };
}

const manager: SessionUser = {
  ...testUser,
  role: {
    id: "role_m",
    name: "MANAGER",
    permissions: [
      "memberships.view",
      "memberships.create",
      "memberships.renew",
      "memberships.freeze",
      "memberships.cancel",
      "membership-plans.view",
    ],
  },
};

/** Section 4.2: a receptionist sells and renews, but never freezes or cancels. */
const receptionist: SessionUser = {
  ...testUser,
  role: {
    id: "role_r",
    name: "RECEPTIONIST",
    permissions: [
      "memberships.view",
      "memberships.create",
      "memberships.renew",
      "membership-plans.view",
    ],
  },
};

function renderDetail(user: SessionUser = manager) {
  useSessionStore.getState().setSession({
    user,
    organization: testOrganization,
    branches: testBranches,
  });

  return renderWithProviders(
    <Routes>
      <Route path="/memberships" element={<h1>Memberships list</h1>} />
      <Route path="/memberships/:membershipId" element={<MembershipDetailPage />} />
    </Routes>,
    { route: `/memberships/${MEMBERSHIP_ID}` },
  );
}

function mockPlans() {
  mock.onGet(PLANS_PATH).reply(200, {
    success: true,
    data: [
      { id: PLAN_ID, name: "Gold — Monthly", price: "1500.00", durationDays: 30, status: "ACTIVE" },
      {
        id: OTHER_PLAN_ID,
        name: "Platinum — Quarterly",
        price: "4000.00",
        durationDays: 90,
        status: "ACTIVE",
      },
    ],
    pagination: { page: 1, limit: 100, total: 2, totalPages: 1 },
  });
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
  mockPlans();
});

afterEach(() => {
  mock.restore();
});

describe("MembershipDetailPage — snapshot display", () => {
  it("shows the price the term was sold at, not the plan's price today", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: membership() });

    renderDetail();

    // The plan now costs ₹1,500 in the catalog above, but this term was sold at ₹1,200.
    mock.resetHandlers();
    mockPlans();
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: membership({ priceAtPurchase: "1200.00" }) });

    expect(await screen.findByTestId("price-at-purchase")).toHaveTextContent("₹1,200.00");
  });

  it("labels a frozen term's countdown as paused", async () => {
    mock.onGet(DETAIL_PATH).reply(200, {
      success: true,
      data: membership({ status: "FROZEN", frozenAt: "2026-09-10T10:00:00.000Z", daysRemaining: 21 }),
    });

    renderDetail();

    expect(await screen.findByTestId("days-remaining")).toHaveTextContent("21");
    expect(screen.getByText("(paused)")).toBeInTheDocument();
  });
});

describe("MembershipDetailPage — transition matrix drives the buttons (1.15.1)", () => {
  const cases: { status: MembershipStatus; visible: string[]; hidden: string[] }[] = [
    {
      status: "ACTIVE",
      visible: ["Renew", "Change plan", "Freeze", "Cancel membership"],
      hidden: ["Unfreeze"],
    },
    {
      status: "FROZEN",
      visible: ["Unfreeze", "Cancel membership"],
      hidden: ["Renew", "Freeze", "Change plan"],
    },
    {
      status: "EXPIRED",
      visible: ["Renew"],
      hidden: ["Freeze", "Unfreeze", "Cancel membership", "Change plan"],
    },
    {
      status: "CANCELLED",
      visible: [],
      hidden: ["Renew", "Freeze", "Unfreeze", "Cancel membership", "Change plan"],
    },
  ];

  for (const { status, visible, hidden } of cases) {
    it(`offers only the legal moves for a ${status} membership`, async () => {
      mock.onGet(DETAIL_PATH).reply(200, { success: true, data: membership({ status }) });

      renderDetail();
      await screen.findByTestId("lifecycle-actions");

      for (const label of visible) {
        expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
      }
      for (const label of hidden) {
        expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
      }
    });
  }

  it("tells the operator what to do next on a closed term", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: membership({ status: "CANCELLED" }) });

    renderDetail();

    expect(await screen.findByText(/this term is closed/i)).toBeInTheDocument();
  });
});

describe("MembershipDetailPage — actions", () => {
  it("freezes and reports that the clock is paused", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: membership() });
    mock
      .onPost(`${DETAIL_PATH}/freeze`)
      .reply(200, { success: true, data: membership({ status: "FROZEN" }) });

    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "Freeze" }));

    expect(await screen.findByTestId("action-notice")).toHaveTextContent(/clock is paused/i);
  });

  it("reports the new end date after unfreezing", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: membership({ status: "FROZEN" }) });
    mock.onPost(`${DETAIL_PATH}/unfreeze`).reply(200, {
      success: true,
      data: membership({ endDate: "2026-10-07", totalFrozenDays: 7 }),
    });

    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "Unfreeze" }));

    expect(await screen.findByTestId("action-notice")).toHaveTextContent("2026-10-07");
  });

  it("asks for confirmation before cancelling, and says cancelling is final", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: membership() });
    mock
      .onPost(`${DETAIL_PATH}/cancel`)
      .reply(200, { success: true, data: membership({ status: "CANCELLED" }) });

    renderDetail();
    await userEvent.click(await screen.findByTestId("cancel-button"));

    const dialog = screen.getByRole("alertdialog", { name: "Confirm cancellation" });
    expect(dialog).toHaveTextContent(/final/i);
    expect(mock.history.post).toHaveLength(0);

    await userEvent.click(screen.getByTestId("confirm-cancel"));
    await waitFor(() => {
      expect(mock.history.post).toHaveLength(1);
    });
  });

  it("navigates to the new row after a renewal, because renewal creates one", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: membership() });
    const renewed = membership({
      id: "01k4h0membership000000002",
      startDate: "2026-10-01",
      endDate: "2026-10-30",
      previousMembershipId: MEMBERSHIP_ID,
    });
    mock.onPost(`${DETAIL_PATH}/renew`).reply(201, { success: true, data: renewed });
    mock
      .onGet(`/organizations/${testOrganization.id}/memberships/${renewed.id}`)
      .reply(200, { success: true, data: renewed });

    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "Renew" }));
    await userEvent.click(screen.getByTestId("confirm-renew"));

    await waitFor(() => {
      expect(screen.getByText(/view the term this one followed/i)).toBeInTheDocument();
    });
  });

  it("states the exact number of days a mid-term plan change forfeits (1.15.4)", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: membership({ daysRemaining: 12 }) });

    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "Change plan" }));

    const warning = screen.getByTestId("forfeit-warning");
    expect(warning).toHaveTextContent("12 unused days will be forfeited");
    expect(warning).toHaveTextContent(/no refund or credit/i);
  });

  it("refuses to switch plans until one is chosen", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: membership() });

    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "Change plan" }));
    await userEvent.click(screen.getByTestId("confirm-change-plan"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/choose the plan/i);
    expect(mock.history.post).toHaveLength(0);
  });

  it("surfaces a server-rejected transition verbatim", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: membership() });
    mock.onPost(`${DETAIL_PATH}/freeze`).reply(409, {
      success: false,
      error: {
        code: "INVALID_MEMBERSHIP_TRANSITION",
        message: "Cannot freeze a EXPIRED membership (EXPIRED → FROZEN is not a valid transition)",
      },
    });

    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "Freeze" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/not a valid transition/i);
  });
});

describe("MembershipDetailPage — RBAC (Section 4.2)", () => {
  it("gives a RECEPTIONIST renew but not freeze, cancel or change plan", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: membership() });

    renderDetail(receptionist);
    await screen.findByTestId("lifecycle-actions");

    expect(screen.getByRole("button", { name: "Renew" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Freeze" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel membership" })).not.toBeInTheDocument();
    // Changing plan cancels a term, so holding only `memberships.create` isn't enough.
    expect(screen.queryByRole("button", { name: "Change plan" })).not.toBeInTheDocument();
  });
});
