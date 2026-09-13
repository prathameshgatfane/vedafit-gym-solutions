import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TrainerDetailPage } from "./TrainerDetailPage";
import { apiClient } from "../../lib/api-client";
import { useSessionStore, type SessionUser } from "../../stores/session.store";
import {
  renderWithProviders,
  testBranches,
  testOrganization,
  testUser,
} from "../../test/test-utils";
import type { TrainerProfile } from "./trainer.types";
import type { Member } from "../members/member.types";

let mock: MockAdapter;

const TRAINER_ID = "01k4h0trainer000000000001";
const DETAIL_PATH = `/organizations/${testOrganization.id}/trainers/${TRAINER_ID}`;
const MEMBERS_PATH = `/organizations/${testOrganization.id}/members`;

const manager: SessionUser = {
  ...testUser,
  role: {
    id: "role_m",
    name: "MANAGER",
    permissions: ["trainers.manage", "members.view"],
  },
};

function profile(overrides: Partial<TrainerProfile> = {}): TrainerProfile {
  return {
    id: TRAINER_ID,
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

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: "01k4h0member0000000000002",
    organizationId: testOrganization.id,
    branchId: testBranches[0]!.id,
    firstName: "Uma",
    lastName: "Unassigned",
    phone: "+919333300002",
    email: null,
    dateOfBirth: null,
    status: "ACTIVE",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
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
      <Route path="/trainers/:trainerId" element={<TrainerDetailPage />} />
    </Routes>,
    { route: `/trainers/${TRAINER_ID}` },
  );
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
});

afterEach(() => {
  mock.restore();
});

describe("TrainerDetailPage", () => {
  it("shows the profile and an empty roster", async () => {
    mock.onGet(DETAIL_PATH).reply(200, { success: true, data: profile() });

    renderDetail();

    expect(await screen.findByTestId("trainer-detail-heading")).toHaveTextContent("Demo Trainer");
    expect(screen.getByTestId("trainer-specialization-value")).toHaveTextContent("Strength");
    expect(screen.getByText("No members assigned yet.")).toBeInTheDocument();
  });

  it("assigns a searched member onto the roster", async () => {
    let current = profile();
    mock.onGet(DETAIL_PATH).reply(() => [200, { success: true, data: current }]);
    mock.onGet(MEMBERS_PATH).reply(200, {
      success: true,
      data: [member()],
      pagination: { page: 1, limit: 8, total: 1, totalPages: 1 },
    });
    mock.onPost(`${DETAIL_PATH}/members`).reply((config) => {
      const body = JSON.parse(String(config.data)) as { memberId: string };
      current = profile({
        assignments: [
          {
            id: "as1",
            memberId: body.memberId,
            assignedAt: "2026-09-07T10:00:00.000Z",
            member: {
              id: body.memberId,
              firstName: "Uma",
              lastName: "Unassigned",
              phone: "+919333300002",
              status: "ACTIVE",
              branchId: testBranches[0]!.id,
            },
          },
        ],
      });
      return [200, { success: true, data: current }];
    });

    renderDetail();
    await screen.findByTestId("assign-search");
    await userEvent.type(screen.getByTestId("assign-search"), "Uma");
    expect(await screen.findByTestId("assign-result")).toHaveTextContent("Uma Unassigned");

    await userEvent.click(screen.getByTestId("assign-button"));
    await waitFor(() => {
      expect(screen.getByTestId("roster-row")).toHaveTextContent("Uma Unassigned");
    });
  });

  it("unassigns a member from the roster", async () => {
    let current = profile({
      assignments: [
        {
          id: "as1",
          memberId: "01k4h0member0000000000001",
          assignedAt: "2026-09-07T10:00:00.000Z",
          member: {
            id: "01k4h0member0000000000001",
            firstName: "Kiran",
            lastName: "Assigned",
            phone: "+919333300001",
            status: "ACTIVE",
            branchId: testBranches[0]!.id,
          },
        },
      ],
    });
    mock.onGet(DETAIL_PATH).reply(() => [200, { success: true, data: current }]);
    mock
      .onDelete(`${DETAIL_PATH}/members/01k4h0member0000000000001`)
      .reply(() => {
        current = profile();
        return [200, { success: true, data: current }];
      });

    renderDetail();
    expect(await screen.findByTestId("roster-row")).toHaveTextContent("Kiran Assigned");
    await userEvent.click(screen.getByTestId("unassign-button"));
    await waitFor(() => {
      expect(screen.getByText("No members assigned yet.")).toBeInTheDocument();
    });
  });
});
