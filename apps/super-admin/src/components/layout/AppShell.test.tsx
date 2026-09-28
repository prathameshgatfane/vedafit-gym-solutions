import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { renderWithProviders, testPlatformUser } from "../../test/test-utils";
import { AppShell } from "./AppShell";
import { SIDEBAR_COLLAPSED_KEY } from "./useSidebarNav";

let mock: MockAdapter;

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

function renderShell() {
  useSessionStore.getState().setSession(testPlatformUser);
  useSessionStore.getState().setAccessToken("token");

  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<h1>Sign in</h1>} />
      <Route path="/" element={<AppShell />}>
        <Route index element={<h1>Dashboard</h1>} />
        <Route path="organizations" element={<h1>Organizations</h1>} />
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
  it("renders sidebar, topbar and the routed page without gym-admin links", () => {
    renderShell();

    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("app-topbar")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Organizations" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "SaaS plans" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /members|payments|audit/i })).not.toBeInTheDocument();
  });

  it("truncates the user name and hides the subtitle on a narrow topbar", () => {
    mockMdUp(false);
    renderShell();

    expect(screen.getByTestId("topbar-user-name")).toHaveClass("truncate");
    expect(screen.getByText("Platform operator")).toHaveClass("hidden");
    expect(screen.getByTestId("sign-out")).toBeInTheDocument();
    expect(screen.getByTestId("theme-toggle")).toBeInTheDocument();
  });

  it("defaults to an expanded sidebar with nav labels visible", () => {
    renderShell();

    expect(screen.getByTestId("sidebar-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Organizations" })).not.toHaveAttribute(
      "title",
      "Organizations",
    );
    expect(screen.getByTestId("app-sidebar")).toHaveTextContent("Super Admin");
  });

  it("collapses to icon-only and keeps each destination name accessible", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByTestId("sidebar-toggle"));

    const orgs = screen.getByRole("link", { name: "Organizations" });
    expect(orgs).toHaveAttribute("title", "Organizations");
    expect(screen.getByTestId("sidebar-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe("1");
  });

  it("restores the collapsed preference from localStorage on a fresh mount", () => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "1");
    renderShell();

    expect(screen.getByTestId("sidebar-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: "Organizations" })).toHaveAttribute(
      "title",
      "Organizations",
    );
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

  it("closes the mobile drawer when clicking the page outside the sidebar", async () => {
    mockMdUp(false);
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByTestId("sidebar-open"));
    expect(screen.getByTestId("sidebar-backdrop")).toBeInTheDocument();

    await user.click(screen.getByRole("heading", { name: "Dashboard" }));
    expect(screen.queryByTestId("sidebar-backdrop")).not.toBeInTheDocument();
  });

  it("logs out through the platform endpoint and clears the in-memory session", async () => {
    const user = userEvent.setup();
    mock.onPost("/auth/platform/logout").reply(200, { success: true, data: { loggedOut: true } });

    renderShell();
    await user.click(screen.getByRole("button", { name: /sign out/i }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(useSessionStore.getState().status).toBe("unauthenticated");
    expect(useSessionStore.getState().accessToken).toBeNull();
    expect(mock.history.post[0]?.url).toBe("/auth/platform/logout");
  });

  it("clears the local session even if platform logout fails", async () => {
    const user = userEvent.setup();
    mock.onPost("/auth/platform/logout").reply(401);

    renderShell();
    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => {
      expect(useSessionStore.getState().status).toBe("unauthenticated");
    });
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
