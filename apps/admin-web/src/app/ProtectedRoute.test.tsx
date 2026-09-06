import { act, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { ProtectedRoute } from "./ProtectedRoute";
import { useSessionStore } from "../stores/session.store";
import {
  renderWithProviders,
  testBranches,
  testOrganization,
  testUser,
} from "../test/test-utils";

function renderGuarded(route = "/") {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<h1>Sign in</h1>} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <h1>Dashboard</h1>
          </ProtectedRoute>
        }
      />
      <Route
        path="/members"
        element={
          <ProtectedRoute>
            <h1>Members</h1>
          </ProtectedRoute>
        }
      />
    </Routes>,
    { route },
  );
}

function authenticate() {
  useSessionStore.getState().setSession({
    user: testUser,
    organization: testOrganization,
    branches: testBranches,
  });
}

beforeEach(() => {
  useSessionStore.getState().clear();
});

describe("ProtectedRoute", () => {
  it("redirects an unauthenticated visitor to the login screen", () => {
    renderGuarded("/");

    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();
  });

  it("renders the protected page for an authenticated user", () => {
    authenticate();
    renderGuarded("/");

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("holds on a loader while the session is still bootstrapping", () => {
    // The cold-load window: the access token is gone (memory only) and the refresh cookie is
    // still being exchanged. Redirecting here would flash the login screen on every reload.
    useSessionStore.setState({ status: "bootstrapping" });
    renderGuarded("/");

    expect(screen.getByRole("status")).toHaveTextContent("Restoring session");
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();
  });

  it("shows the page once bootstrapping resolves to a valid session", async () => {
    useSessionStore.setState({ status: "bootstrapping" });
    renderGuarded("/");

    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => authenticate());

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("redirects once bootstrapping resolves to no session", async () => {
    useSessionStore.setState({ status: "bootstrapping" });
    renderGuarded("/");

    act(() => useSessionStore.getState().markUnauthenticated());

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("ejects a signed-in user the moment the session is cleared", async () => {
    // This is how an unrecoverable 401 reaches the UI: the interceptor clears the store, and the
    // guard reacts — no window.location assignment anywhere in the api-client.
    authenticate();
    renderGuarded("/");
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();

    act(() => useSessionStore.getState().clear());

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    });
  });

  it("guards every protected route, not just the index", () => {
    renderGuarded("/members");

    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Members" })).not.toBeInTheDocument();
  });
});
