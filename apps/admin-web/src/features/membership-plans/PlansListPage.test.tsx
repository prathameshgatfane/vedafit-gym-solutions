import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlansListPage } from "./PlansListPage";
import { apiClient } from "../../lib/api-client";
import { useSessionStore, type SessionUser } from "../../stores/session.store";
import {
  renderWithProviders,
  testBranches,
  testOrganization,
  testUser,
} from "../../test/test-utils";
import type { MembershipPlan } from "./plan.types";

let mock: MockAdapter;

const LIST_PATH = `/organizations/${testOrganization.id}/membership-plans`;

function plan(overrides: Partial<MembershipPlan> = {}): MembershipPlan {
  return {
    id: "01k4h0plan00000000000001",
    organizationId: testOrganization.id,
    name: "Gold — Monthly",
    price: "1500.00",
    durationDays: 30,
    status: "ACTIVE",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

const manager: SessionUser = {
  ...testUser,
  role: {
    id: "role_m",
    name: "MANAGER",
    permissions: ["membership-plans.view", "membership-plans.manage"],
  },
};

/** Section 4.2: a receptionist reads the catalog to sell from it, but can't change prices. */
const receptionist: SessionUser = {
  ...testUser,
  role: { id: "role_r", name: "RECEPTIONIST", permissions: ["membership-plans.view"] },
};

function renderList(user: SessionUser = manager, route = "/membership-plans") {
  useSessionStore.getState().setSession({
    user,
    organization: testOrganization,
    branches: testBranches,
  });
  return renderWithProviders(<PlansListPage />, { route });
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
});

afterEach(() => {
  mock.restore();
});

describe("PlansListPage", () => {
  it("renders plans with formatted price and duration", async () => {
    mock.onGet(LIST_PATH).reply(200, {
      success: true,
      data: [plan(), plan({ id: "02", name: "Silver — Yearly", price: "12000.00", durationDays: 365 })],
      pagination: { page: 1, limit: 10, total: 2, totalPages: 1 },
    });

    renderList();

    expect(await screen.findByText("Gold — Monthly")).toBeInTheDocument();
    const rows = within(screen.getByTestId("plans-table")).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("₹1,500.00");
    expect(rows[1]).toHaveTextContent("1 month");
    expect(rows[2]).toHaveTextContent("1 year");
  });

  it("says out loud that a price change won't reach issued memberships", async () => {
    mock.onGet(LIST_PATH).reply(200, {
      success: true,
      data: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 1 },
    });

    renderList();

    expect(
      await screen.findByText(/only affects memberships sold from now on/i),
    ).toBeInTheDocument();
  });

  it("sends the URL's filters to the API and reflects them in the controls", async () => {
    mock.onGet(LIST_PATH).reply(200, {
      success: true,
      data: [plan()],
      pagination: { page: 2, limit: 25, total: 30, totalPages: 2 },
    });

    renderList(manager, "/membership-plans?search=gold&status=ACTIVE&sortBy=price&sortOrder=desc&page=2&limit=25");

    await screen.findByText("Gold — Monthly");
    expect(mock.history.get[0]!.params).toMatchObject({
      search: "gold",
      status: "ACTIVE",
      sortBy: "price",
      sortOrder: "desc",
      page: 2,
      limit: 25,
    });
    expect(screen.getByLabelText("Sort by")).toHaveValue("price");
    expect(screen.getByLabelText("Page size")).toHaveValue("25");
  });

  it("retires an active plan through the API", async () => {
    mock.onGet(LIST_PATH).reply(200, {
      success: true,
      data: [plan()],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });
    mock
      .onPatch(`${LIST_PATH}/01k4h0plan00000000000001`)
      .reply(200, { success: true, data: plan({ status: "INACTIVE" }) });

    renderList();
    await screen.findByText("Gold — Monthly");
    await userEvent.click(screen.getByRole("button", { name: "Retire" }));

    await waitFor(() => {
      expect(mock.history.patch).toHaveLength(1);
    });
    expect(JSON.parse(mock.history.patch[0]!.data)).toEqual({ status: "INACTIVE" });
  });

  it("surfaces a rejected status change instead of silently doing nothing", async () => {
    mock.onGet(LIST_PATH).reply(200, {
      success: true,
      data: [plan()],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });
    mock.onPatch(`${LIST_PATH}/01k4h0plan00000000000001`).reply(403, {
      success: false,
      error: { code: "PERMISSION_DENIED", message: "This role lacks the required permission" },
    });

    renderList();
    await screen.findByText("Gold — Monthly");
    await userEvent.click(screen.getByRole("button", { name: "Retire" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/lacks the required permission/i);
  });

  it("hides every management control from a read-only role", async () => {
    mock.onGet(LIST_PATH).reply(200, {
      success: true,
      data: [plan()],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });

    renderList(receptionist);
    await screen.findByText("Gold — Monthly");

    expect(screen.queryByRole("button", { name: "Add plan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retire" })).not.toBeInTheDocument();
  });

  it("surfaces a failed load, preferring the server's own message", async () => {
    mock.onGet(LIST_PATH).reply(500, {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
    });

    renderList();

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("falls back to its own wording when the failure carries no message", async () => {
    // A proxy or load balancer failing in front of the API returns a response, but not one in
    // the `{ error: { message } }` envelope — so there is nothing to quote.
    mock.onGet(LIST_PATH).reply(502, "<html>Bad Gateway</html>");

    renderList();

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load membership plans/i);
  });
});
