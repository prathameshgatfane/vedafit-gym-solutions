import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotificationsPage } from "./NotificationsPage";
import { apiClient } from "../../lib/api-client";
import { useSessionStore, type SessionUser } from "../../stores/session.store";
import { renderWithProviders, testOrganization, testUser } from "../../test/test-utils";
import type { NotificationLog } from "./notification.types";

let mock: MockAdapter;

const owner: SessionUser = {
  ...testUser,
  role: {
    id: "role_o",
    name: "OWNER",
    permissions: ["notifications.manage"],
  },
};

function log(overrides: Partial<NotificationLog> = {}): NotificationLog {
  return {
    id: "01k4h0notify000000000001",
    organizationId: testOrganization.id,
    memberId: "m1",
    event: "MEMBERSHIP_EXPIRING",
    channel: "SMS",
    status: "SENT",
    entityType: "MEMBERSHIP",
    entityId: "ms1",
    localDate: "2026-09-08",
    body: "Hi Expiry, your Gold membership expires on 2026-09-11.",
    lastError: null,
    sentAt: "2026-09-08T15:40:00.000Z",
    createdAt: "2026-09-08T15:39:00.000Z",
    member: { id: "m1", firstName: "Expiry", lastName: "Soon", phone: "+919000100001" },
    ...overrides,
  };
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
});

afterEach(() => {
  mock.restore();
});

describe("NotificationsPage", () => {
  it("renders log history and runs a scan", async () => {
    mock
      .onGet(`/organizations/${testOrganization.id}/notifications/logs`)
      .reply(200, {
        success: true,
        data: [log()],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
    mock
      .onGet(`/organizations/${testOrganization.id}/notifications/templates`)
      .reply(200, { success: true, data: [] });
    mock.onPost(`/organizations/${testOrganization.id}/notifications/run`).reply(202, {
      success: true,
      data: { queued: 1, skipped: 0, logIds: ["x"] },
      message: "Queued 1 notification",
    });

    useSessionStore.getState().setSession({
      user: owner,
      organization: testOrganization,
      branches: [],
    });
    renderWithProviders(<NotificationsPage />, { route: "/notifications" });

    expect(await screen.findByText("Expiry Soon")).toBeInTheDocument();
    expect(screen.getByText(/Gold membership expires/)).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("run-nightly"));
    expect(await screen.findByTestId("run-result")).toHaveTextContent("Queued 1");
  });
});
