import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "../stores/session.store";
import {
  __resetRefreshStateForTests,
  apiClient,
  apiErrorCode,
  apiErrorMessage,
  refreshAccessToken,
} from "./api-client";

const API_URL = "http://localhost:4000/api/v1";

let clientMock: MockAdapter;
let axiosMock: MockAdapter;

function seedAuthenticatedSession(token = "access-token-1") {
  useSessionStore.setState({ status: "authenticated", accessToken: token });
}

beforeEach(() => {
  clientMock = new MockAdapter(apiClient);
  axiosMock = new MockAdapter(axios);
  __resetRefreshStateForTests();
  useSessionStore.getState().clear();
});

afterEach(() => {
  clientMock.restore();
  axiosMock.restore();
});

describe("request interceptor", () => {
  it("attaches the in-memory access token as a bearer header", async () => {
    seedAuthenticatedSession("token-abc");
    clientMock.onGet("/platform/organizations").reply(200, { success: true, data: [] });

    await apiClient.get("/platform/organizations");

    expect(clientMock.history.get[0]?.headers?.Authorization).toBe("Bearer token-abc");
  });

  it("sends credentials so the httpOnly platform_refresh cookie travels with requests", () => {
    expect(apiClient.defaults.withCredentials).toBe(true);
  });
});

describe("refresh-on-401 interceptor", () => {
  it("refreshes via /auth/platform/refresh and replays the original request", async () => {
    seedAuthenticatedSession("expired-token");

    clientMock
      .onGet("/platform/organizations")
      .replyOnce(401, { success: false, error: { code: "INVALID_TOKEN", message: "expired" } })
      .onGet("/platform/organizations")
      .replyOnce(200, { success: true, data: [{ id: "org_1" }] });

    axiosMock.onPost(`${API_URL}/auth/platform/refresh`).replyOnce(200, {
      success: true,
      data: { accessToken: "fresh-token" },
    });

    const response = await apiClient.get("/platform/organizations");

    expect(response.status).toBe(200);
    expect(axiosMock.history.post[0]?.url).toBe(`${API_URL}/auth/platform/refresh`);
    expect(axiosMock.history.post.some((call) => call.url === `${API_URL}/auth/refresh`)).toBe(
      false,
    );
    expect(clientMock.history.get[1]?.headers?.Authorization).toBe("Bearer fresh-token");
  });

  it("clears the session when the platform refresh itself fails", async () => {
    seedAuthenticatedSession("expired-token");

    clientMock.onGet("/platform/organizations").reply(401, {
      success: false,
      error: { code: "INVALID_TOKEN", message: "expired" },
    });
    axiosMock.onPost(`${API_URL}/auth/platform/refresh`).reply(401, {
      success: false,
      error: { code: "INVALID_TOKEN", message: "revoked" },
    });

    await expect(apiClient.get("/platform/organizations")).rejects.toBeDefined();

    expect(useSessionStore.getState().status).toBe("unauthenticated");
    expect(useSessionStore.getState().accessToken).toBeNull();
  });

  it("does not attempt to refresh a failed platform login", async () => {
    clientMock.onPost("/auth/platform/login").reply(401, {
      success: false,
      error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
    });

    await expect(apiClient.post("/auth/platform/login", {})).rejects.toBeDefined();
    expect(axiosMock.history.post).toHaveLength(0);
  });

  it("never calls staff /auth/refresh", async () => {
    await expect(refreshAccessToken()).rejects.toBeDefined();
    expect(axiosMock.history.post.some((call) => call.url?.endsWith("/auth/refresh"))).toBe(false);
    expect(axiosMock.history.post.every((call) => call.url?.includes("/auth/platform/refresh"))).toBe(
      true,
    );
  });
});

describe("single-flight refresh", () => {
  it("collapses concurrent platform refreshes into one network call", async () => {
    axiosMock.onPost(`${API_URL}/auth/platform/refresh`).reply(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve([200, { success: true, data: { accessToken: "one-token" } }]),
            20,
          );
        }),
    );

    const results = await Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ]);

    expect(axiosMock.history.post).toHaveLength(1);
    expect(results).toEqual(["one-token", "one-token", "one-token"]);
  });
});

describe("error helpers", () => {
  it("reads the API error message and code", async () => {
    clientMock.onGet("/platform/dashboard").reply(403, {
      success: false,
      error: { code: "INVALID_TOKEN", message: "Platform authentication required" },
    });

    try {
      await apiClient.get("/platform/dashboard");
      throw new Error("expected failure");
    } catch (error) {
      expect(apiErrorMessage(error)).toBe("Platform authentication required");
      expect(apiErrorCode(error)).toBe("INVALID_TOKEN");
    }
  });
});
