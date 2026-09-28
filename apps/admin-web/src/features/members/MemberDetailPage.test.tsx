import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemberDetailPage } from "./MemberDetailPage";
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

const MEMBER_ID = "01k4h0member0000000000001";
const DETAIL_PATH = `/organizations/${testOrganization.id}/members/${MEMBER_ID}`;
const ARCHIVE_PATH = `${DETAIL_PATH}/archive`;
const PORTAL_PATH = `${DETAIL_PATH}/portal-password`;

const baseMember: Member = {
  id: MEMBER_ID,
  organizationId: testOrganization.id,
  branchId: testBranches[0]!.id,
  firstName: "Aarav",
  lastName: "Singh",
  phone: "+919000000001",
  email: "aarav@example.test",
  dateOfBirth: "1994-03-17",
  status: "ACTIVE",
  portalEnabled: false,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

/** Section 4.2: a receptionist may create/view/update members, but not archive them. */
const receptionist: SessionUser = {
  ...testUser,
  name: "Riya Reception",
  role: {
    id: "role_r",
    name: "RECEPTIONIST",
    permissions: ["members.create", "members.view", "members.update"],
  },
};

const trainer: SessionUser = {
  ...testUser,
  name: "Tara Trainer",
  role: {
    id: "role_t",
    name: "TRAINER",
    permissions: ["members.view"],
  },
};

function renderDetail(user: SessionUser = testUser) {
  useSessionStore.getState().setSession({
    user,
    organization: testOrganization,
    branches: testBranches,
  });

  return renderWithProviders(
    <Routes>
      <Route path="/members" element={<h1>Members list</h1>} />
      <Route path="/members/:memberId" element={<MemberDetailPage />} />
      <Route path="/members/:memberId/edit" element={<h1>Edit member</h1>} />
    </Routes>,
    { route: `/members/${MEMBER_ID}` },
  );
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
});

afterEach(() => {
  mock.restore();
});

describe("MemberDetailPage", () => {
  it("renders the member's details", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: baseMember });
    renderDetail();

    expect(await screen.findByTestId("member-name")).toHaveTextContent("Aarav Singh");
    expect(screen.getByText("+919000000001")).toBeInTheDocument();
    expect(screen.getByText("aarav@example.test")).toBeInTheDocument();
    expect(screen.getByText("1994-03-17")).toBeInTheDocument();
    // Resolved to a readable name rather than showing a raw ULID.
    expect(screen.getByText("Main Branch")).toBeInTheDocument();
    expect(screen.getByTestId("status-badge")).toHaveTextContent("ACTIVE");
    expect(screen.getByTestId("portal-badge")).toHaveTextContent("Portal not enabled");
  });

  it("shows a dash for fields the member doesn't have", async () => {
    mock
      .onGet(DETAIL_PATH)
      .reply(200, { success: true, data: { ...baseMember, email: null, dateOfBirth: null } });
    renderDetail();

    await screen.findByTestId("member-name");
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("reports a member that could not be loaded", async () => {
    mock.onGet(DETAIL_PATH).reply(404, {
      success: false,
      error: { code: "MEMBER_NOT_FOUND", message: "Member not found" },
    });
    renderDetail();

    expect(await screen.findByRole("alert")).toHaveTextContent("Member not found");
  });

  it("navigates to the edit form", async () => {
    const user = userEvent.setup();
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: baseMember });
    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("heading", { name: "Edit member" })).toBeInTheDocument();
  });
});

describe("MemberDetailPage archive", () => {
  it("confirms before archiving, then updates the status in place", async () => {
    const user = userEvent.setup();

    // Archiving invalidates the detail query, so the refetch has to see the new status the way a
    // real server would — a fixed ACTIVE response would just overwrite the change again.
    let stored = { ...baseMember };
    mock.onGet(DETAIL_PATH).reply(() => [200, { success: true, data: stored }]);
    mock.onPost(ARCHIVE_PATH).reply(() => {
      stored = { ...stored, status: "ARCHIVED" };
      return [200, { success: true, data: stored }];
    });

    renderDetail();
    await user.click(await screen.findByTestId("archive-button"));

    // Nothing is sent until the confirmation is accepted.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);

    await user.click(screen.getByTestId("confirm-archive"));

    await waitFor(() => {
      expect(screen.getByTestId("status-badge")).toHaveTextContent("ARCHIVED");
    });
    expect(mock.history.post).toHaveLength(1);
  });

  it("sends nothing when the confirmation is dismissed", async () => {
    const user = userEvent.setup();
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: baseMember });

    renderDetail();
    await user.click(await screen.findByTestId("archive-button"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
  });

  it("drops Edit and Archive once the member is archived", async () => {
    mock
      .onGet(DETAIL_PATH)
      .reply(200, { success: true, data: { ...baseMember, status: "ARCHIVED" } });
    renderDetail();

    await screen.findByTestId("member-name");
    expect(screen.queryByTestId("archive-button")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("portal-password-button")).not.toBeInTheDocument();
  });

  it("hides the archive action from a RECEPTIONIST but keeps Edit", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: baseMember });
    renderDetail(receptionist);

    await screen.findByTestId("member-name");
    expect(screen.queryByTestId("archive-button")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable portal" })).toBeInTheDocument();
  });

  it("surfaces a server-side PERMISSION_DENIED rather than pretending it worked", async () => {
    // The UI guard is a convenience; the API is the authority, and its refusal must be visible.
    const user = userEvent.setup();
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: baseMember });
    mock.onPost(ARCHIVE_PATH).reply(403, {
      success: false,
      error: {
        code: "PERMISSION_DENIED",
        message: "This role lacks the required permission: members.archive",
      },
    });

    renderDetail();
    await user.click(await screen.findByTestId("archive-button"));
    await user.click(screen.getByTestId("confirm-archive"));

    expect(await screen.findByRole("alert")).toHaveTextContent("members.archive");
    expect(screen.getByTestId("status-badge")).toHaveTextContent("ACTIVE");
  });
});

describe("MemberDetailPage portal password", () => {
  it("hides Enable portal from a role without members.update", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: baseMember });
    renderDetail(trainer);

    await screen.findByTestId("member-name");
    expect(screen.getByTestId("portal-badge")).toHaveTextContent("Portal not enabled");
    expect(screen.queryByTestId("portal-password-button")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable portal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset portal password" })).not.toBeInTheDocument();
  });

  it("shows Reset portal password once the member is already enabled", async () => {
    mock
      .onGet(DETAIL_PATH)
      .reply(200, { success: true, data: { ...baseMember, portalEnabled: true } });
    renderDetail();

    await screen.findByTestId("member-name");
    expect(screen.getByTestId("portal-badge")).toHaveTextContent("Portal enabled");
    expect(screen.getByRole("button", { name: "Reset portal password" })).toBeInTheDocument();
  });

  it("shows the temp password once; refetch is portalEnabled with no password in the response", async () => {
    const user = userEvent.setup();
    let stored = { ...baseMember, portalEnabled: false };
    mock.onGet(DETAIL_PATH).reply(() => [200, { success: true, data: stored }]);
    mock.onPost(PORTAL_PATH).reply(() => {
      stored = { ...stored, portalEnabled: true };
      return [
        200,
        {
          success: true,
          data: {
            portalEnabled: true,
            temporaryPassword: "TempPass12",
            phone: stored.phone,
            organizationSlug: "demo-gym",
          },
        },
      ];
    });

    renderDetail();
    await user.click(await screen.findByTestId("portal-password-button"));
    expect(screen.getByTestId("portal-password-dialog")).toBeInTheDocument();
    await user.click(screen.getByTestId("portal-generate"));

    expect(await screen.findByTestId("portal-temp-password")).toHaveTextContent("TempPass12");
    expect(screen.getByTestId("portal-revealed-phone")).toHaveTextContent("+919000000001");
    expect(screen.getByTestId("portal-revealed-slug")).toHaveTextContent("demo-gym");
    expect(screen.getByText(/shown once/i)).toBeInTheDocument();
    expect(screen.queryByTestId("portal-password-dialog")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("portal-badge")).toHaveTextContent("Portal enabled");
    });
    await waitFor(() => {
      expect(mock.history.get.filter((call) => call.url === DETAIL_PATH).length).toBeGreaterThan(1);
    });

    expect(stored.portalEnabled).toBe(true);
    expect(JSON.stringify(stored)).not.toMatch(/passwordHash|temporaryPassword|TempPass12/);
    expect(JSON.stringify({ success: true, data: stored })).not.toMatch(
      /passwordHash|temporaryPassword/,
    );

    const posted = JSON.parse(mock.history.post[0]!.data as string) as Record<string, unknown>;
    expect(posted).toEqual({});

    await user.click(screen.getByTestId("portal-dismiss"));
    expect(screen.queryByTestId("portal-password-revealed")).not.toBeInTheDocument();
    expect(screen.queryByText("TempPass12")).not.toBeInTheDocument();
  });

  it("sends a typed password and copies it from the one-time panel", async () => {
    const user = userEvent.setup();
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: baseMember });
    mock.onPost(PORTAL_PATH).reply(200, {
      success: true,
      data: {
        portalEnabled: true,
        temporaryPassword: "FrontDesk1",
        phone: baseMember.phone,
        organizationSlug: "demo-gym",
      },
    });

    renderDetail();
    await user.click(await screen.findByTestId("portal-password-button"));
    await user.type(screen.getByLabelText(/temporary password/i), "FrontDesk1");
    await user.click(screen.getByTestId("portal-set-password"));

    expect(await screen.findByTestId("portal-temp-password")).toHaveTextContent("FrontDesk1");
    const posted = JSON.parse(mock.history.post[0]!.data as string) as { password: string };
    expect(posted.password).toBe("FrontDesk1");

    await user.click(screen.getByTestId("portal-copy"));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("rejects a weak typed password before calling the API", async () => {
    const user = userEvent.setup();
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: baseMember });

    renderDetail();
    await user.click(await screen.findByTestId("portal-password-button"));
    await user.type(screen.getByLabelText(/temporary password/i), "short");
    await user.click(screen.getByTestId("portal-set-password"));

    expect(await screen.findByText("Password must be at least 8 characters")).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
  });

  it("surfaces a server-side PERMISSION_DENIED on enable", async () => {
    const user = userEvent.setup();
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: baseMember });
    mock.onPost(PORTAL_PATH).reply(403, {
      success: false,
      error: {
        code: "PERMISSION_DENIED",
        message: "This role lacks the required permission: members.update",
      },
    });

    renderDetail();
    await user.click(await screen.findByTestId("portal-password-button"));
    await user.click(screen.getByTestId("portal-generate"));

    expect(await screen.findByRole("alert")).toHaveTextContent("members.update");
    expect(screen.getByTestId("portal-badge")).toHaveTextContent("Portal not enabled");
    expect(screen.queryByTestId("portal-password-revealed")).not.toBeInTheDocument();
  });
});
