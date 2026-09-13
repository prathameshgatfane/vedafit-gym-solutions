import { screen } from "@testing-library/react";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { renderWithProviders, testPlatformUser } from "../../test/test-utils";
import { DashboardPage } from "./DashboardPage";

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().setSession(testPlatformUser);
});

afterEach(() => {
  mock.restore();
  useSessionStore.getState().clear();
});

describe("DashboardPage", () => {
  it("renders fleet counts from the platform dashboard API", async () => {
    mock.onGet("/platform/dashboard").reply(200, {
      success: true,
      data: {
        organizationsByStatus: { ACTIVE: 4, SUSPENDED: 1 },
        trialsEnding: 2,
        signupsThisPeriod: 3,
      },
    });

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByTestId("stat-active")).toHaveTextContent("4");
    expect(screen.getByTestId("stat-suspended")).toHaveTextContent("1");
    expect(screen.getByTestId("stat-trials")).toHaveTextContent("2");
    expect(screen.getByTestId("stat-signups")).toHaveTextContent("3");
  });

  it("surfaces a load failure", async () => {
    mock.onGet("/platform/dashboard").reply(500, {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Dashboard unavailable" },
    });

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Dashboard unavailable");
  });
});
