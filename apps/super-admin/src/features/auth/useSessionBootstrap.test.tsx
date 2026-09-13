import { render, waitFor } from "@testing-library/react";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetRefreshStateForTests, apiClient } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { testPlatformUser } from "../../test/test-utils";
import { useSessionBootstrap } from "./useSessionBootstrap";

const API_URL = "http://localhost:4000/api/v1";

function Probe() {
  useSessionBootstrap();
  return null;
}

let clientMock: MockAdapter;
let axiosMock: MockAdapter;

beforeEach(() => {
  clientMock = new MockAdapter(apiClient);
  axiosMock = new MockAdapter(axios);
  __resetRefreshStateForTests();
  useSessionStore.setState({ status: "bootstrapping", accessToken: null, user: null });
});

afterEach(() => {
  clientMock.restore();
  axiosMock.restore();
});

describe("useSessionBootstrap", () => {
  it("restores a platform session from the platform_refresh cookie", async () => {
    axiosMock.onPost(`${API_URL}/auth/platform/refresh`).reply(200, {
      success: true,
      data: { accessToken: "restored-access" },
    });
    clientMock.onGet("/auth/platform/me").reply(200, {
      success: true,
      data: { user: testPlatformUser },
    });

    render(<Probe />);

    await waitFor(() => {
      expect(useSessionStore.getState().status).toBe("authenticated");
    });
    expect(useSessionStore.getState().accessToken).toBe("restored-access");
    expect(useSessionStore.getState().user?.email).toBe("platform@vedafit.test");
    expect(axiosMock.history.post[0]?.url).toBe(`${API_URL}/auth/platform/refresh`);
    expect(axiosMock.history.post.some((call) => call.url?.includes("/auth/refresh"))).toBe(false);
  });

  it("marks the session unauthenticated when platform refresh fails", async () => {
    axiosMock.onPost(`${API_URL}/auth/platform/refresh`).reply(401, {
      success: false,
      error: { code: "INVALID_TOKEN", message: "revoked" },
    });

    render(<Probe />);

    await waitFor(() => {
      expect(useSessionStore.getState().status).toBe("unauthenticated");
    });
    expect(useSessionStore.getState().accessToken).toBeNull();
  });
});
