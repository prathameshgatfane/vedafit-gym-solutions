import { screen, within } from "@testing-library/react";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LeadsListPage } from "./LeadsListPage";
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

const LIST_PATH = `/organizations/${testOrganization.id}/leads`;
const ASSIGNEES_PATH = `/organizations/${testOrganization.id}/leads/assignees`;

const manager: SessionUser = {
  ...testUser,
  role: { id: "role_m", name: "MANAGER", permissions: ["leads.manage"] },
};

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "01k4h0lead000000000000001",
    organizationId: testOrganization.id,
    branchId: testBranches[0]!.id,
    name: "Priya Walkin",
    phone: "+919222200001",
    source: "walk-in",
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

function renderList(route = "/leads") {
  useSessionStore.getState().setSession({
    user: manager,
    organization: testOrganization,
    branches: testBranches,
  });
  return renderWithProviders(<LeadsListPage />, { route });
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  mock.onGet(ASSIGNEES_PATH).reply(200, { success: true, data: [] });
  useSessionStore.getState().clear();
});

afterEach(() => {
  mock.restore();
});

describe("LeadsListPage", () => {
  it("renders leads with pipeline status", async () => {
    mock.onGet(LIST_PATH).reply(200, {
      success: true,
      data: [lead({ status: "CONTACTED", assignedTo: { id: "u1", name: "Riya", email: "r@x" } })],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });

    renderList();

    expect(await screen.findByText("Priya Walkin")).toBeInTheDocument();
    const rows = within(screen.getByTestId("leads-table")).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("CONTACTED");
    expect(rows[1]).toHaveTextContent("Riya");
    expect(screen.getByRole("button", { name: /add lead/i })).toBeInTheDocument();
  });

  it("says so when the pipeline is empty", async () => {
    mock.onGet(LIST_PATH).reply(200, {
      success: true,
      data: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });

    renderList();

    expect(await screen.findByText("No leads yet.")).toBeInTheDocument();
  });
});
