import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LoginPage } from "./LoginPage";
import { apiClient } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import {
  renderWithProviders,
  testBranches,
  testOrganization,
  testUser,
} from "../../test/test-utils";

let mock: MockAdapter;

const loginSuccess = {
  success: true,
  data: {
    accessToken: "access-token-xyz",
    tokenType: "Bearer",
    expiresIn: 900,
    user: {
      id: testUser.id,
      name: testUser.name,
      email: testUser.email,
      organizationId: testOrganization.id,
      branchId: null,
      roleId: testUser.role.id,
    },
  },
};

const meSuccess = {
  success: true,
  data: { user: testUser, organization: testOrganization, branches: testBranches },
};

/** Login plus the destination, so a successful submit can be observed as a real navigation. */
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

describe("LoginPage validation", () => {
  it("blocks submission and reports both missing fields", async () => {
    const user = userEvent.setup();
    renderLoginFlow();

    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Email is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    // Zod rejected it client-side; nothing should have reached the API.
    expect(mock.history.post).toHaveLength(0);
  });

  it("rejects a malformed email before calling the API", async () => {
    const user = userEvent.setup();
    renderLoginFlow();

    await user.type(screen.getByLabelText(/email/i), "not-an-email");
    await user.type(screen.getByLabelText(/password/i), "Password123!");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
  });

  it("marks the invalid field for assistive technology", async () => {
    const user = userEvent.setup();
    renderLoginFlow();

    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toHaveAttribute("aria-invalid", "true");
    });
  });
});

describe("LoginPage submission", () => {
  it("signs in, hydrates the session from /auth/me, and lands on the dashboard", async () => {
    const user = userEvent.setup();
    mock.onPost("/auth/login").reply(200, loginSuccess);
    mock.onGet("/auth/me").reply(200, meSuccess);

    renderLoginFlow();

    await user.type(screen.getByLabelText(/email/i), "owner@demo-gym.test");
    await user.type(screen.getByLabelText(/password/i), "Password123!");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();

    const state = useSessionStore.getState();
    expect(state.status).toBe("authenticated");
    expect(state.accessToken).toBe("access-token-xyz");
    expect(state.user?.email).toBe("owner@demo-gym.test");
    expect(state.organization?.name).toBe("Demo Gym");
    expect(state.branches).toHaveLength(1);

    // /auth/me must carry the token issued moments earlier.
    expect(mock.history.get[0]?.headers?.Authorization).toBe("Bearer access-token-xyz");
  });

  it("shows the API's message on bad credentials and keeps the user signed out", async () => {
    const user = userEvent.setup();
    mock.onPost("/auth/login").reply(401, {
      success: false,
      error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
    });

    renderLoginFlow();

    await user.type(screen.getByLabelText(/email/i), "owner@demo-gym.test");
    await user.type(screen.getByLabelText(/password/i), "wrong-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(useSessionStore.getState().status).not.toBe("authenticated");
    expect(useSessionStore.getState().accessToken).toBeNull();
    expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();
  });

  it("surfaces a rate-limit lockout in plain language", async () => {
    const user = userEvent.setup();
    mock.onPost("/auth/login").reply(429, {
      success: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many failed login attempts. Try again in 15 minutes.",
      },
    });

    renderLoginFlow();

    await user.type(screen.getByLabelText(/email/i), "owner@demo-gym.test");
    await user.type(screen.getByLabelText(/password/i), "wrong-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Too many failed login attempts/);
  });

  it("disables the submit button while the request is in flight", async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    mock.onPost("/auth/login").reply(
      () =>
        new Promise((resolve) => {
          release = () => resolve([200, loginSuccess]);
        }),
    );
    mock.onGet("/auth/me").reply(200, meSuccess);

    renderLoginFlow();

    await user.type(screen.getByLabelText(/email/i), "owner@demo-gym.test");
    await user.type(screen.getByLabelText(/password/i), "Password123!");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    const button = await screen.findByRole("button", { name: /signing in/i });
    expect(button).toBeDisabled();

    release?.();
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("sends an already-authenticated visitor straight to the dashboard", async () => {
    useSessionStore.getState().setSession({
      user: testUser,
      organization: testOrganization,
      branches: testBranches,
    });

    renderLoginFlow();

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });
});
