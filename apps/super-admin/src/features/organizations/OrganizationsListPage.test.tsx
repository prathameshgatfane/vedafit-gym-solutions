import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { renderWithProviders, testPlatformUser } from "../../test/test-utils";
import { OrganizationsListPage } from "./OrganizationsListPage";
import type { OrganizationListItem } from "./organization.types";

let mock: MockAdapter;

function org(overrides: Partial<OrganizationListItem> = {}): OrganizationListItem {
  return {
    id: "org_demo",
    name: "Demo Gym",
    slug: "demo-gym",
    email: "hello@demo-gym.test",
    phone: "+911234567890",
    status: "ACTIVE",
    timezone: "Asia/Kolkata",
    createdAt: "2026-09-01T10:00:00.000Z",
    subscription: {
      status: "ACTIVE",
      planCode: "growth",
      currentPeriodEnd: "2027-09-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

function replyWith(items: OrganizationListItem[], total = items.length, page = 1, limit = 20) {
  return [
    200,
    {
      success: true,
      data: items,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    },
  ] as [number, unknown];
}

function lastListParams(): Record<string, unknown> {
  const calls = mock.history.get.filter((call) => call.url === "/platform/organizations");
  return (calls[calls.length - 1]?.params ?? {}) as Record<string, unknown>;
}

function renderList(route = "/organizations") {
  useSessionStore.getState().setSession(testPlatformUser);
  return renderWithProviders(
    <Routes>
      <Route path="/organizations" element={<OrganizationsListPage />} />
      <Route path="/organizations/new" element={<h1>New organization</h1>} />
      <Route path="/organizations/:organizationId" element={<h1>Organization detail</h1>} />
    </Routes>,
    { route },
  );
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
});

afterEach(() => {
  mock.restore();
});

describe("OrganizationsListPage rendering", () => {
  it("renders organizations returned by the platform API", async () => {
    mock.onGet("/platform/organizations").reply(() =>
      replyWith([
        org(),
        org({
          id: "org_b",
          name: "Beta Gym",
          slug: "beta-gym",
          status: "SUSPENDED",
          subscription: { status: "TRIAL", planCode: "trial", currentPeriodEnd: "2026-09-20T00:00:00.000Z" },
        }),
      ]),
    );

    renderList();

    expect(await screen.findByText("Demo Gym")).toBeInTheDocument();
    expect(screen.getByText("Beta Gym")).toBeInTheDocument();
    expect(screen.getByText("2 organizations")).toBeInTheDocument();
    expect(screen.getByText("growth")).toBeInTheDocument();
  });

  it("shows an empty state when there are no organizations", async () => {
    mock.onGet("/platform/organizations").reply(() => replyWith([]));
    renderList();

    expect(await screen.findByText("No organizations yet.")).toBeInTheDocument();
  });

  it("distinguishes no matches when filters are active", async () => {
    mock.onGet("/platform/organizations").reply(() => replyWith([]));
    renderList("/organizations?search=zzz");

    expect(await screen.findByText("No organizations match those filters.")).toBeInTheDocument();
  });

  it("surfaces a load failure instead of an empty table", async () => {
    mock.onGet("/platform/organizations").reply(500, {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Something broke" },
    });

    renderList();

    expect(await screen.findByRole("alert")).toHaveTextContent("Something broke");
  });
});

describe("OrganizationsListPage filtering and paging", () => {
  it("reads the initial filter state out of the URL", async () => {
    mock.onGet("/platform/organizations").reply(() => replyWith([org()], 1, 2));

    renderList("/organizations?search=Demo&status=ACTIVE&page=2&sortBy=name&sortOrder=desc");

    await screen.findByText("Demo Gym");

    expect(lastListParams()).toMatchObject({
      search: "Demo",
      status: "ACTIVE",
      page: 2,
      sortBy: "name",
      sortOrder: "desc",
    });
  });

  it("sends search after debounce", async () => {
    const user = userEvent.setup();
    mock.onGet("/platform/organizations").reply(() => replyWith([org()]));
    renderList();
    await screen.findByText("Demo Gym");

    await user.clear(screen.getByLabelText(/search/i));
    await user.type(screen.getByLabelText(/search/i), "beta");

    await waitFor(() => {
      expect(lastListParams().search).toBe("beta");
    });
  });

  it("requests the next page", async () => {
    const user = userEvent.setup();
    mock.onGet("/platform/organizations").reply((config) => {
      const page = Number(config.params?.page ?? 1);
      return replyWith([org({ name: page === 1 ? "Page One Gym" : "Page Two Gym" })], 40, page, 20);
    });

    renderList();
    expect(await screen.findByText("Page One Gym")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText("Page Two Gym")).toBeInTheDocument();
    expect(lastListParams().page).toBe(2);
  });

  it("opens the create page from the list", async () => {
    const user = userEvent.setup();
    mock.onGet("/platform/organizations").reply(() => replyWith([org()]));
    renderList();
    await screen.findByText("Demo Gym");

    await user.click(screen.getByRole("button", { name: /new organization/i }));
    expect(screen.getByRole("heading", { name: "New organization" })).toBeInTheDocument();
  });
});
