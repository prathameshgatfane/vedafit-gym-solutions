import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MembersListPage } from "./MembersListPage";
import { apiClient } from "../../lib/api-client";
import { useSessionStore, type SessionUser } from "../../stores/session.store";
import {
  renderWithProviders,
  testBranches,
  testOrganization,
  testUser,
} from "../../test/test-utils";
import type { Member } from "./member.types";

let mock: MockAdapter;

const MEMBERS_PATH = `/organizations/${testOrganization.id}/members`;

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: "01k4h0member0000000000001",
    organizationId: testOrganization.id,
    branchId: testBranches[0]!.id,
    firstName: "Aarav",
    lastName: "Singh",
    phone: "+919000000001",
    email: "aarav@example.test",
    dateOfBirth: "1994-03-17",
    status: "ACTIVE",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

function replyWith(items: Member[], total = items.length, page = 1, limit = 10) {
  return [
    200,
    {
      success: true,
      data: items,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    },
  ] as [number, unknown];
}

/** The query string the component actually sent on its most recent list request. */
function lastListParams(): Record<string, unknown> {
  const calls = mock.history.get.filter((c) => c.url === MEMBERS_PATH);
  return (calls[calls.length - 1]?.params ?? {}) as Record<string, unknown>;
}

function renderList(user: SessionUser = testUser, route = "/members") {
  useSessionStore.getState().setSession({
    user,
    organization: testOrganization,
    branches: testBranches,
  });

  return renderWithProviders(
    <Routes>
      <Route path="/members" element={<MembersListPage />} />
      <Route path="/members/new" element={<h1>Add member</h1>} />
      <Route path="/members/:memberId" element={<h1>Member detail</h1>} />
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

describe("MembersListPage rendering", () => {
  it("renders members returned by the API", async () => {
    mock.onGet(MEMBERS_PATH).reply(() =>
      replyWith([
        member({ firstName: "Aarav", lastName: "Singh" }),
        member({ id: "02", firstName: "Bhavna", lastName: "Rao", status: "INACTIVE" }),
      ]),
    );

    renderList();

    expect(await screen.findByText("Aarav Singh")).toBeInTheDocument();
    expect(screen.getByText("Bhavna Rao")).toBeInTheDocument();
    expect(screen.getByText("2 members")).toBeInTheDocument();

    const badges = screen.getAllByTestId("status-badge").map((b) => b.textContent);
    expect(badges).toEqual(["ACTIVE", "INACTIVE"]);
  });

  it("shows an empty state when there are no members", async () => {
    mock.onGet(MEMBERS_PATH).reply(() => replyWith([]));
    renderList();

    expect(await screen.findByText("No members yet.")).toBeInTheDocument();
  });

  it("distinguishes 'no members' from 'no matches' when filters are active", async () => {
    mock.onGet(MEMBERS_PATH).reply(() => replyWith([]));
    renderList(testUser, "/members?search=zzz");

    expect(await screen.findByText("No members match those filters.")).toBeInTheDocument();
  });

  it("surfaces a load failure instead of an empty table", async () => {
    mock.onGet(MEMBERS_PATH).reply(500, {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Something broke" },
    });

    renderList();

    expect(await screen.findByRole("alert")).toHaveTextContent("Something broke");
  });

  it("hides Add member from a role without members.create and names the own-roster empty set", async () => {
    mock.onGet(MEMBERS_PATH).reply(() => replyWith([]));
    const trainer: SessionUser = {
      ...testUser,
      role: {
        id: "role_t",
        name: "TRAINER",
        permissions: ["members.view", "attendance.view"],
      },
    };

    renderList(trainer);

    expect(await screen.findByTestId("own-roster-banner")).toBeInTheDocument();
    expect(await screen.findByText("No members assigned to you yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add member/i })).not.toBeInTheDocument();
  });
});

describe("MembersListPage filtering, sorting and paging", () => {
  it("reads the initial filter state out of the URL", async () => {
    mock.onGet(MEMBERS_PATH).reply(() => replyWith([member()], 1, 2));

    renderList(testUser, "/members?search=Singh&status=INACTIVE&page=2&sortBy=firstName&sortOrder=asc");

    await screen.findByText("Aarav Singh");
    expect(lastListParams()).toMatchObject({
      search: "Singh",
      status: "INACTIVE",
      page: 2,
      sortBy: "firstName",
      sortOrder: "asc",
    });
  });

  it("debounces typing in the search box into a single request", async () => {
    const user = userEvent.setup();
    mock.onGet(MEMBERS_PATH).reply(() => replyWith([member()]));

    renderList();
    await screen.findByText("Aarav Singh");
    const before = mock.history.get.length;

    await user.type(screen.getByLabelText("Search"), "Singh");

    await waitFor(() => {
      expect(lastListParams().search).toBe("Singh");
    });
    // Five keystrokes must not mean five requests.
    expect(mock.history.get.length - before).toBeLessThan(5);
  });

  it("sends the status filter", async () => {
    const user = userEvent.setup();
    mock.onGet(MEMBERS_PATH).reply(() => replyWith([member()]));

    renderList();
    await screen.findByText("Aarav Singh");

    await user.selectOptions(screen.getByLabelText("Status"), "ARCHIVED");

    await waitFor(() => {
      expect(lastListParams().status).toBe("ARCHIVED");
    });
  });

  it("omits an empty status rather than sending a blank filter", async () => {
    mock.onGet(MEMBERS_PATH).reply(() => replyWith([member()]));
    renderList();

    await screen.findByText("Aarav Singh");
    expect(lastListParams()).not.toHaveProperty("status");
  });

  it("sends sort field and direction", async () => {
    const user = userEvent.setup();
    mock.onGet(MEMBERS_PATH).reply(() => replyWith([member()]));

    renderList();
    await screen.findByText("Aarav Singh");

    await user.selectOptions(screen.getByLabelText("Sort by"), "firstName");
    await waitFor(() => expect(lastListParams().sortBy).toBe("firstName"));

    await user.selectOptions(screen.getByLabelText("Order"), "asc");
    await waitFor(() => expect(lastListParams().sortOrder).toBe("asc"));
  });

  it("pages forward while preserving the active filters", async () => {
    const user = userEvent.setup();
    mock.onGet(MEMBERS_PATH).reply(() => replyWith([member()], 25, 1, 10));

    renderList(testUser, "/members?search=Singh&status=INACTIVE");
    await screen.findByText("Aarav Singh");

    await user.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      // The combination is the point: paging must not silently drop search or status.
      expect(lastListParams()).toMatchObject({ page: 2, search: "Singh", status: "INACTIVE" });
    });
  });

  it("returns to page 1 when a filter changes", async () => {
    const user = userEvent.setup();
    mock.onGet(MEMBERS_PATH).reply(() => replyWith([member()], 25, 3, 10));

    renderList(testUser, "/members?page=3");
    await screen.findByText("Aarav Singh");
    expect(lastListParams().page).toBe(3);

    await user.selectOptions(screen.getByLabelText("Status"), "ACTIVE");

    await waitFor(() => {
      // Staying on page 3 of a smaller result set would show an empty table.
      expect(lastListParams()).toMatchObject({ page: 1, status: "ACTIVE" });
    });
  });

  it("shows a page size that came from the URL rather than misreporting it", async () => {
    mock.onGet(MEMBERS_PATH).reply(() => replyWith([member()], 5, 1, 2));
    renderList(testUser, "/members?limit=2");

    await screen.findByText("Aarav Singh");
    expect(screen.getByLabelText("Page size")).toHaveValue("2");
    expect(screen.getByRole("option", { name: "2 per page" })).toBeInTheDocument();
  });

  it("hides paging controls for a single-page result", async () => {
    mock.onGet(MEMBERS_PATH).reply(() => replyWith([member()], 1));
    renderList();

    await screen.findByText("Aarav Singh");
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });

  it("clears every filter at once", async () => {
    const user = userEvent.setup();
    mock.onGet(MEMBERS_PATH).reply(() => replyWith([member()]));

    renderList(testUser, "/members?search=Singh&status=INACTIVE");
    await screen.findByText("Aarav Singh");

    await user.click(screen.getByRole("button", { name: /clear filters/i }));

    await waitFor(() => {
      const params = lastListParams();
      expect(params).not.toHaveProperty("search");
      expect(params).not.toHaveProperty("status");
    });
  });

  it("ignores a junk sort field in the URL rather than passing it to the API", async () => {
    mock.onGet(MEMBERS_PATH).reply(() => replyWith([member()]));
    renderList(testUser, "/members?sortBy=passwordHash");

    await screen.findByText("Aarav Singh");
    expect(lastListParams().sortBy).toBe("createdAt");
  });
});

describe("MembersListPage navigation", () => {
  it("opens a member's detail page from the table", async () => {
    const user = userEvent.setup();
    mock.onGet(MEMBERS_PATH).reply(() => replyWith([member()]));

    renderList();
    await user.click(await screen.findByRole("link", { name: "Aarav Singh" }));

    expect(await screen.findByRole("heading", { name: "Member detail" })).toBeInTheDocument();
  });

  it("opens the create form from the Add member button", async () => {
    const user = userEvent.setup();
    mock.onGet(MEMBERS_PATH).reply(() => replyWith([]));

    renderList();
    await screen.findByText("No members yet.");
    await user.click(screen.getByRole("button", { name: /add member/i }));

    expect(await screen.findByRole("heading", { name: "Add member" })).toBeInTheDocument();
  });

  it("renders phone and email in the row", async () => {
    mock.onGet(MEMBERS_PATH).reply(() => replyWith([member({ email: null })]));
    renderList();

    const row = (await screen.findByText("Aarav Singh")).closest("tr")!;
    expect(within(row).getByText("+919000000001")).toBeInTheDocument();
    expect(within(row).getByText("—")).toBeInTheDocument();
  });
});
