import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetRefreshStateForTests,
  apiClient,
  apiErrorCode,
  apiErrorMessage,
  refreshAccessToken,
} from "./api-client";
import { useSessionStore } from "../stores/session.store";

const API_URL = "http://localhost:4000/api/v1";

/** `apiClient` and the bare-axios refresh call need separate adapters. */
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
    clientMock.onGet("/members").reply(200, { success: true, data: [] });

    await apiClient.get("/members");

    expect(clientMock.history.get[0]?.headers?.Authorization).toBe("Bearer token-abc");
  });

  it("sends no Authorization header when there is no session", async () => {
    clientMock.onGet("/members").reply(200, { success: true, data: [] });

    await apiClient.get("/members");

    expect(clientMock.history.get[0]?.headers?.Authorization).toBeUndefined();
  });

  it("sends credentials so the httpOnly refresh cookie travels with requests", () => {
    expect(apiClient.defaults.withCredentials).toBe(true);
  });
});

describe("refresh-on-401 interceptor", () => {
  it("refreshes and replays the original request once, transparently to the caller", async () => {
    seedAuthenticatedSession("expired-token");

    // First call with the stale token 401s; the replay (new token) succeeds.
    clientMock
      .onGet("/members")
      .replyOnce(401, { success: false, error: { code: "INVALID_TOKEN", message: "expired" } })
      .onGet("/members")
      .replyOnce(200, { success: true, data: [{ id: "mem_1" }] });

    axiosMock
      .onPost(`${API_URL}/auth/refresh`)
      .replyOnce(200, { success: true, data: { accessToken: "fresh-token" } });

    const response = await apiClient.get("/members");

    expect(response.status).toBe(200);
    expect(response.data.data).toEqual([{ id: "mem_1" }]);

    // The caller never saw the 401, and the replay carried the new token.
    expect(clientMock.history.get).toHaveLength(2);
    expect(clientMock.history.get[1]?.headers?.Authorization).toBe("Bearer fresh-token");
    expect(useSessionStore.getState().accessToken).toBe("fresh-token");
  });

  it("gives up after a single retry instead of looping", async () => {
    seedAuthenticatedSession("expired-token");

    // The API 401s even with a freshly minted token — e.g. the user was deactivated.
    clientMock.onGet("/members").reply(401, {
      success: false,
      error: { code: "INVALID_TOKEN", message: "expired" },
    });
    axiosMock
      .onPost(`${API_URL}/auth/refresh`)
      .reply(200, { success: true, data: { accessToken: "fresh-token" } });

    await expect(apiClient.get("/members")).rejects.toMatchObject({
      response: { status: 401 },
    });

    expect(clientMock.history.get).toHaveLength(2);
    expect(axiosMock.history.post).toHaveLength(1);
  });

  it("clears the session when the refresh itself fails", async () => {
    seedAuthenticatedSession("expired-token");
    useSessionStore.setState({ status: "authenticated" });

    clientMock.onGet("/members").reply(401, {
      success: false,
      error: { code: "INVALID_TOKEN", message: "expired" },
    });
    axiosMock.onPost(`${API_URL}/auth/refresh`).reply(401, {
      success: false,
      error: { code: "INVALID_TOKEN", message: "revoked" },
    });

    await expect(apiClient.get("/members")).rejects.toBeDefined();

    // ProtectedRoute keys off exactly this to bounce the user to /login.
    expect(useSessionStore.getState().status).toBe("unauthenticated");
    expect(useSessionStore.getState().accessToken).toBeNull();
  });

  it("does not attempt to refresh a failed login", async () => {
    clientMock.onPost("/auth/login").reply(401, {
      success: false,
      error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
    });

    await expect(apiClient.post("/auth/login", {})).rejects.toBeDefined();

    // No refresh call — a 401 from /auth/login means wrong password, not a stale token.
    expect(axiosMock.history.post).toHaveLength(0);
  });

  it("passes non-401 failures straight through", async () => {
    seedAuthenticatedSession();
    clientMock.onGet("/members").reply(403, {
      success: false,
      error: { code: "PERMISSION_DENIED", message: "nope" },
    });

    await expect(apiClient.get("/members")).rejects.toMatchObject({
      response: { status: 403 },
    });
    expect(axiosMock.history.post).toHaveLength(0);
  });
});

describe("single-flight refresh", () => {
  it("collapses concurrent refreshes into one network call", async () => {
    // The API revokes a whole token family when a spent refresh token is replayed, so two
    // parallel refreshes would log the user out. Exactly one request must go out.
    axiosMock
      .onPost(`${API_URL}/auth/refresh`)
      .reply(() =>
        new Promise((resolve) => {
          setTimeout(() => resolve([200, { success: true, data: { accessToken: "one-token" } }]), 20);
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

  it("collapses refreshes triggered by concurrent 401s into one", async () => {
    seedAuthenticatedSession("expired-token");

    clientMock
      .onGet("/members")
      .replyOnce(401, { success: false, error: { code: "INVALID_TOKEN", message: "expired" } })
      .onGet("/branches")
      .replyOnce(401, { success: false, error: { code: "INVALID_TOKEN", message: "expired" } })
      .onGet("/members")
      .reply(200, { success: true, data: ["members"] })
      .onGet("/branches")
      .reply(200, { success: true, data: ["branches"] });

    axiosMock.onPost(`${API_URL}/auth/refresh`).reply(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve([200, { success: true, data: { accessToken: "fresh" } }]), 20);
        }),
    );

    const [members, branches] = await Promise.all([
      apiClient.get("/members"),
      apiClient.get("/branches"),
    ]);

    expect(axiosMock.history.post).toHaveLength(1);
    expect(members.data.data).toEqual(["members"]);
    expect(branches.data.data).toEqual(["branches"]);
  });

  it("allows a fresh refresh after the previous one settles", async () => {
    axiosMock
      .onPost(`${API_URL}/auth/refresh`)
      .replyOnce(200, { success: true, data: { accessToken: "first" } })
      .onPost(`${API_URL}/auth/refresh`)
      .replyOnce(200, { success: true, data: { accessToken: "second" } });

    expect(await refreshAccessToken()).toBe("first");
    expect(await refreshAccessToken()).toBe("second");
    expect(axiosMock.history.post).toHaveLength(2);
  });

  it("clears the in-flight promise after a failure so a later refresh can retry", async () => {
    axiosMock
      .onPost(`${API_URL}/auth/refresh`)
      .replyOnce(401, { success: false, error: { code: "INVALID_TOKEN", message: "no" } })
      .onPost(`${API_URL}/auth/refresh`)
      .replyOnce(200, { success: true, data: { accessToken: "recovered" } });

    await expect(refreshAccessToken()).rejects.toBeDefined();
    expect(await refreshAccessToken()).toBe("recovered");
  });
});

describe("error helpers", () => {
  it("surfaces the API's message and code", async () => {
    clientMock.onPost("/members").reply(409, {
      success: false,
      error: { code: "DUPLICATE_PHONE", message: "A member with this phone already exists" },
    });

    try {
      await apiClient.post("/members", {});
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(apiErrorMessage(error)).toBe("A member with this phone already exists");
      expect(apiErrorCode(error)).toBe("DUPLICATE_PHONE");
    }
  });

  it("explains a dead API rather than showing a raw axios message", async () => {
    clientMock.onGet("/members").networkError();

    try {
      await apiClient.get("/members");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(apiErrorMessage(error)).toMatch(/Could not reach the server/);
    }
  });
});
