import { screen, within } from "@testing-library/react";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TrainersListPage } from "./TrainersListPage";
import { apiClient } from "../../lib/api-client";
import { useSessionStore, type SessionUser } from "../../stores/session.store";
import {
  renderWithProviders,
  testBranches,
  testOrganization,
  testUser,
} from "../../test/test-utils";
import type { TrainerProfile } from "./trainer.types";

let mock: MockAdapter;

const LIST_PATH = `/organizations/${testOrganization.id}/trainers`;

const manager: SessionUser = {
  ...testUser,
  role: { id: "role_m", name: "MANAGER", permissions: ["trainers.manage"] },
};

function trainer(overrides: Partial<TrainerProfile> = {}): TrainerProfile {
  return {
    id: "01k4h0trainer000000000001",
    organizationId: testOrganization.id,
    userId: "01k4h0user00000000000001",
    specialization: "Strength",
    commissionPct: "10.50",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    user: {
      id: "01k4h0user00000000000001",
      name: "Demo Trainer",
      email: "trainer@demo-gym.test",
      status: "ACTIVE",
      branchId: testBranches[0]!.id,
    },
    assignments: [],
    ...overrides,
  };
}

function renderList(route = "/trainers") {
  useSessionStore.getState().setSession({
    user: manager,
    organization: testOrganization,
    branches: testBranches,
  });
  return renderWithProviders(<TrainersListPage />, { route });
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
});

afterEach(() => {
  mock.restore();
});

describe("TrainersListPage", () => {
  it("renders trainer profiles with assignment counts", async () => {
    mock.onGet(LIST_PATH).reply(200, {
      success: true,
      data: [
        trainer({
          assignments: [
            {
              id: "a1",
              memberId: "m1",
              assignedAt: "2026-09-07T10:00:00.000Z",
              member: {
                id: "m1",
                firstName: "Kiran",
                lastName: "Assigned",
                phone: "+919333300001",
                status: "ACTIVE",
                branchId: testBranches[0]!.id,
              },
            },
          ],
        }),
      ],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });

    renderList();

    expect(await screen.findByText("Demo Trainer")).toBeInTheDocument();
    const rows = within(screen.getByTestId("trainers-table")).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Strength");
    expect(rows[1]).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /add trainer/i })).toBeInTheDocument();
  });

  it("says so when there are no profiles yet", async () => {
    mock.onGet(LIST_PATH).reply(200, {
      success: true,
      data: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });

    renderList();

    expect(await screen.findByText("No trainer profiles yet.")).toBeInTheDocument();
  });
});
