import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { renderWithProviders, testPlatformUser } from "../../test/test-utils";
import { LoginPage } from "./LoginPage";

let mock: MockAdapter;

const loginSuccess = {
  success: true,
  data: {
    accessToken: "platform-access-xyz",
    tokenType: "Bearer",
    expiresIn: 900,
    user: testPlatformUser,
  },
};

const meSuccess = {
  success: true,
  data: { user: testPlatformUser },
};

function renderLoginFlow() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<h1>Dashboard</h1>} />
    </Routes>,
    { route: "/login" },
  );
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
});

afterEach(() => {
  mock.restore();
});

describe("Super Admin LoginPage", () => {
  it("signs in through /auth/platform/login, hydrates /auth/platform/me, and keeps the token in memory", async () => {
    const user = userEvent.setup();
    mock.onPost("/auth/platform/login").reply(200, loginSuccess);
    mock.onGet("/auth/platform/me").reply(200, meSuccess);

    renderLoginFlow();

    await user.type(screen.getByLabelText(/email/i), "platform@vedafit.test");
    await user.type(screen.getByLabelText(/password/i), "ChangeMe123!");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();

    const state = useSessionStore.getState();
    expect(state.status).toBe("authenticated");
    expect(state.accessToken).toBe("platform-access-xyz");
    expect(state.user?.email).toBe("platform@vedafit.test");
    expect("organizationId" in state).toBe(false);
    expect("isSuperAdmin" in state).toBe(false);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(JSON.stringify(state)).not.toMatch(/refresh/i);

    expect(mock.history.post[0]?.url).toBe("/auth/platform/login");
    expect(mock.history.get[0]?.url).toBe("/auth/platform/me");
    expect(mock.history.get[0]?.headers?.Authorization).toBe("Bearer platform-access-xyz");
    expect(mock.history.post.some((call) => call.url === "/auth/login")).toBe(false);
  });

  it("blocks submission when email and password are missing", async () => {
    const user = userEvent.setup();
    renderLoginFlow();

    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Email is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
  });

  it("shows the API message on bad credentials and does not persist a token", async () => {
    const user = userEvent.setup();
    mock.onPost("/auth/platform/login").reply(401, {
      success: false,
      error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
    });

    renderLoginFlow();

    await user.type(screen.getByLabelText(/email/i), "platform@vedafit.test");
    await user.type(screen.getByLabelText(/password/i), "wrong-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(useSessionStore.getState().status).not.toBe("authenticated");
    expect(useSessionStore.getState().accessToken).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it("does not call gym staff /auth/login", async () => {
    const user = userEvent.setup();
    mock.onPost("/auth/platform/login").reply(200, loginSuccess);
    mock.onGet("/auth/platform/me").reply(200, meSuccess);
    mock.onPost("/auth/login").reply(500);

    renderLoginFlow();
    await user.type(screen.getByLabelText(/email/i), "platform@vedafit.test");
    await user.type(screen.getByLabelText(/password/i), "ChangeMe123!");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(useSessionStore.getState().status).toBe("authenticated");
    });
    expect(mock.history.post.filter((call) => call.url === "/auth/login")).toHaveLength(0);
  });
});
