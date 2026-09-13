import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";
import { SIDEBAR_COLLAPSED_KEY } from "./useSidebarNav";
import { apiClient } from "../../lib/api-client";
import { useSessionStore, type SessionUser } from "../../stores/session.store";
import {
  renderWithProviders,
  testBranches,
  testOrganization,
  testUser,
} from "../../test/test-utils";

function mockMdUp(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("min-width: 768px") ? matches : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

let mock: MockAdapter;

const secondBranch = {
  id: "01k4h0test0branch00000002",
  name: "North Branch",
  address: null,
  phone: null,
  status: "ACTIVE" as const,
};

function renderShell(user: SessionUser = testUser, branches = testBranches) {
  useSessionStore.getState().setSession({ user, organization: testOrganization, branches });
  useSessionStore.getState().setAccessToken("token");

  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<h1>Sign in</h1>} />
      <Route path="/" element={<AppShell />}>
        <Route index element={<h1>Dashboard</h1>} />
      </Route>
    </Routes>,
    { route: "/" },
  );
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
  window.localStorage.clear();
  mockMdUp(true);
});

afterEach(() => {
  mock.restore();
});

describe("AppShell", () => {
  it("renders sidebar, topbar and the routed page", () => {
    renderShell();

    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("app-topbar")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("shows the organization, user and role from the session", () => {
    renderShell();

    expect(screen.getByTestId("app-sidebar")).toHaveTextContent("Demo Gym");
    expect(screen.getByTestId("app-topbar")).toHaveTextContent("Priya Owner");
    expect(screen.getByTestId("app-topbar")).toHaveTextContent("OWNER");
  });

  it("hides nav items the role has no permission for", () => {
    const receptionist: SessionUser = {
      ...testUser,
      name: "Riya Reception",
      branchId: testBranches[0]!.id,
      role: { id: "role_r", name: "RECEPTIONIST", permissions: ["members.view"] },
    };
    renderShell(receptionist);

    const sidebar = screen.getByTestId("app-sidebar");
    expect(sidebar).toHaveTextContent("Members");
    // `users.manage` / `notifications.manage` are OWNER/ADMIN permissions (4.2).
    expect(sidebar).not.toHaveTextContent("Staff");
    expect(sidebar).not.toHaveTextContent("Trainers");
    expect(sidebar).not.toHaveTextContent("Notifications");
  });

  it("offers a branch picker only to an org-wide user with several branches", () => {
    renderShell(testUser, [testBranches[0]!, secondBranch]);
    expect(screen.getByLabelText("Active branch")).toBeInTheDocument();
  });

  it("gives a branch-scoped user no branch picker", () => {
    const receptionist: SessionUser = { ...testUser, branchId: testBranches[0]!.id };
    renderShell(receptionist, [testBranches[0]!, secondBranch]);

    expect(screen.queryByLabelText("Active branch")).not.toBeInTheDocument();
  });

  it("truncates the user name and hides the role on a narrow topbar without dropping OWNER from the tree", () => {
    mockMdUp(false);
    renderShell(testUser, [testBranches[0]!, secondBranch]);

    expect(screen.getByTestId("topbar-user-name")).toHaveClass("truncate");
    expect(screen.getByText("OWNER")).toHaveClass("hidden");
    expect(screen.getByLabelText("Active branch")).toBeInTheDocument();
    expect(screen.getByTestId("sign-out")).toBeInTheDocument();
  });

  it("logs out: revokes server-side, clears state, and redirects to login", async () => {
    const user = userEvent.setup();
    mock.onPost("/auth/logout").reply(200, { success: true, data: null });

    renderShell();
    await user.click(screen.getByTestId("sign-out"));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(mock.history.post.map((r) => r.url)).toContain("/auth/logout");

    const state = useSessionStore.getState();
    expect(state.status).toBe("unauthenticated");
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
  });

  it("still clears the local session when the logout request fails", async () => {
    // Leaving someone "logged in" in the UI after they asked to leave is the worse outcome.
    const user = userEvent.setup();
    mock.onPost("/auth/logout").networkError();

    renderShell();
    await user.click(screen.getByTestId("sign-out"));

    await waitFor(() => {
      expect(useSessionStore.getState().status).toBe("unauthenticated");
    });
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("defaults to an expanded sidebar with nav labels visible", () => {
    renderShell();

    expect(screen.getByTestId("sidebar-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Members" })).not.toHaveAttribute("title", "Members");
    expect(screen.getByTestId("app-sidebar")).toHaveTextContent("Demo Gym");
  });

  it("collapses to icon-only and keeps each destination name accessible", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByTestId("sidebar-toggle"));

    const members = screen.getByRole("link", { name: "Members" });
    expect(members).toHaveAttribute("title", "Members");
    expect(screen.getByTestId("sidebar-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe("1");
  });

  it("restores the collapsed preference from localStorage on a fresh mount", () => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "1");
    renderShell();

    expect(screen.getByTestId("sidebar-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: "Members" })).toHaveAttribute("title", "Members");
  });

  it("opens the mobile drawer as an overlay and closes it from the backdrop", async () => {
    mockMdUp(false);
    const user = userEvent.setup();
    renderShell();

    expect(screen.queryByTestId("sidebar-backdrop")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("sidebar-open"));

    expect(screen.getByTestId("sidebar-open")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("sidebar-backdrop")).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");

    await user.click(screen.getByTestId("sidebar-backdrop"));
    expect(screen.queryByTestId("sidebar-backdrop")).not.toBeInTheDocument();
    expect(screen.getByTestId("sidebar-open")).toHaveAttribute("aria-expanded", "false");
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("closes the mobile drawer on Escape", async () => {
    mockMdUp(false);
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByTestId("sidebar-open"));
    expect(screen.getByTestId("sidebar-backdrop")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("sidebar-backdrop")).not.toBeInTheDocument();
  });
});
