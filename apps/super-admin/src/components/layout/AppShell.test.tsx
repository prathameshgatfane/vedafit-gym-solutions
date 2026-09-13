import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { renderWithProviders, testPlatformUser } from "../../test/test-utils";
import { AppShell } from "./AppShell";

let mock: MockAdapter;

function renderShell() {
  useSessionStore.getState().setSession(testPlatformUser);
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
