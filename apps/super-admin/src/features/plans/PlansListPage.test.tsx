import { screen } from "@testing-library/react";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { renderWithProviders, testPlatformUser } from "../../test/test-utils";
import { PlansListPage } from "./PlansListPage";

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().setSession(testPlatformUser);
});

afterEach(() => {
  mock.restore();
  useSessionStore.getState().clear();
});

describe("PlansListPage", () => {
  it("renders the catalog as read-only cards", async () => {
    mock.onGet("/platform/plans").reply(200, {
      success: true,
      data: [
        {
          id: "plan_trial",
          code: "trial",
          name: "Trial",
          description: "Default signup",
          priceMonthly: "0.00",
          priceYearly: "0.00",
          currency: "INR",
          trialDays: 14,
          isActive: true,
          entitlements: [
            { key: "members.max", valueType: "LIMIT", intValue: 50, boolValue: null },
          ],
        },
      ],
    });

    renderWithProviders(<PlansListPage />);

    expect(await screen.findByText("Trial")).toBeInTheDocument();
    expect(screen.getByText("members.max")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save|edit|create/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/entitlement/i)).not.toBeInTheDocument();
  });
});
