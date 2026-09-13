import { describe, expect, it } from "vitest";
import { apiClient } from "./api-client";
import { useSessionStore } from "../stores/session.store";

describe("super-admin security contract", () => {
  it("does not keep a refresh token or password in JS storage", () => {
    useSessionStore.getState().setAccessToken("access-only");
    useSessionStore.getState().setSession({
      id: "p1",
      name: "Op",
      email: "platform@vedafit.test",
      status: "ACTIVE",
    });

    expect(useSessionStore.getState().accessToken).toBe("access-only");
    expect(JSON.stringify(useSessionStore.getState())).not.toMatch(/refresh/i);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect("organizationId" in useSessionStore.getState()).toBe(false);
    expect("isSuperAdmin" in useSessionStore.getState()).toBe(false);
  });

  it("uses cookie credentials and a platform-only API client", () => {
    expect(apiClient.defaults.withCredentials).toBe(true);
    expect(String(apiClient.defaults.baseURL)).toMatch(/\/api\/v1$/);
  });

  it("does not persist the access token across a clear", () => {
    useSessionStore.getState().setAccessToken("access-only");
    useSessionStore.getState().clear();
    expect(useSessionStore.getState().accessToken).toBeNull();
    expect(useSessionStore.getState().status).toBe("unauthenticated");
  });
});
