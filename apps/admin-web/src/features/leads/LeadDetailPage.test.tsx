import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LeadDetailPage } from "./LeadDetailPage";
import { apiClient } from "../../lib/api-client";
import { useSessionStore, type SessionUser } from "../../stores/session.store";
import {
  renderWithProviders,
  testBranches,
  testOrganization,
  testUser,
} from "../../test/test-utils";
import type { Lead } from "./lead.types";

let mock: MockAdapter;

const LEAD_ID = "01k4h0lead000000000000001";
const DETAIL_PATH = `/organizations/${testOrganization.id}/leads/${LEAD_ID}`;

const manager: SessionUser = {
  ...testUser,
  role: { id: "role_m", name: "MANAGER", permissions: ["leads.manage"] },
};

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: LEAD_ID,
    organizationId: testOrganization.id,
    branchId: testBranches[0]!.id,
    name: "Zoya Convert",
    phone: "+919222200009",
    source: "instagram",
    status: "NEW",
    assignedToUserId: null,
    followUpAt: null,
    convertedMemberId: null,
    createdAt: "2026-09-08T10:00:00.000Z",
    updatedAt: "2026-09-08T10:00:00.000Z",
    allowedTransitions: ["CONTACTED", "TRIAL_SCHEDULED", "LOST"],
    assignedTo: null,
    branch: { id: testBranches[0]!.id, name: "Main Branch" },
    convertedMember: null,
    ...overrides,
  };
}

function renderDetail() {
  useSessionStore.getState().setSession({
    user: manager,
    organization: testOrganization,
    branches: testBranches,
  });
  return renderWithProviders(
    <Routes>
      <Route path="/leads/:leadId" element={<LeadDetailPage />} />
    </Routes>,
    { route: `/leads/${LEAD_ID}` },
  );
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
});

afterEach(() => {
  mock.restore();
});

describe("LeadDetailPage", () => {
  it("offers forward pipeline moves and convert, and not a backward one", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: lead() });

    renderDetail();

    expect(await screen.findByTestId("lead-detail-heading")).toHaveTextContent("Zoya Convert");
    expect(screen.getByTestId("transition-CONTACTED")).toBeInTheDocument();
    expect(screen.getByTestId("transition-TRIAL_SCHEDULED")).toBeInTheDocument();
    expect(screen.getByTestId("transition-LOST")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^new$/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("convert-form")).toBeInTheDocument();
  });

  it("moves NEW → CONTACTED through the pipeline action", async () => {
    let current = lead();
    mock.onGet(DETAIL_PATH).reply(() => [200, { success: true, data: current }]);
    mock.onPatch(DETAIL_PATH).reply((config) => {
      const body = JSON.parse(String(config.data)) as { status: string };
      current = lead({
        status: body.status as Lead["status"],
        allowedTransitions: body.status === "CONTACTED" ? ["TRIAL_SCHEDULED", "LOST"] : [],
      });
      return [200, { success: true, data: current }];
    });

    renderDetail();
    await userEvent.click(await screen.findByTestId("transition-CONTACTED"));
    await waitFor(() => {
      expect(screen.getByTestId("status-badge")).toHaveTextContent("CONTACTED");
    });
    expect(screen.queryByTestId("transition-CONTACTED")).not.toBeInTheDocument();
  });

  it("converts an open lead and then treats it as history", async () => {
    let current = lead();
    mock.onGet(DETAIL_PATH).reply(() => [200, { success: true, data: current }]);
    mock.onPost(`${DETAIL_PATH}/convert`).reply(() => {
      current = lead({
        status: "CONVERTED",
        allowedTransitions: [],
        convertedMemberId: "01k4h0member0000000000009",
        convertedMember: {
          id: "01k4h0member0000000000009",
          firstName: "Zoya",
          lastName: "Convert",
          phone: "+919222200009",
          status: "ACTIVE",
        },
      });
      return [200, { success: true, data: current }];
    });

    renderDetail();
    await screen.findByTestId("convert-form");
    await userEvent.click(screen.getByTestId("convert-submit"));

    expect(await screen.findByTestId("converted-banner")).toHaveTextContent("Zoya Convert");
    expect(screen.queryByTestId("convert-form")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });
});
