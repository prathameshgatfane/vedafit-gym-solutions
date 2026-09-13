import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AttendancePage } from "./AttendancePage";
import { apiClient } from "../../lib/api-client";
import {
  useSessionStore,
  type SessionBranch,
  type SessionUser,
} from "../../stores/session.store";
import { renderWithProviders, testOrganization, testUser } from "../../test/test-utils";
import type { Attendance } from "./attendance.types";
import type { Member } from "../members/member.types";

let mock: MockAdapter;

const ORG = testOrganization.id;
const ATTENDANCE_PATH = `/organizations/${ORG}/attendance`;
const TODAY_PATH = `${ATTENDANCE_PATH}/today`;
const MEMBERS_PATH = `/organizations/${ORG}/members`;

const TODAY = "2026-09-07";

const mainBranch: SessionBranch = {
  id: "01k4h0test0branch00000001",
  name: "Andheri",
  address: null,
  phone: null,
  status: "ACTIVE",
};

const receptionist: SessionUser = {
  ...testUser,
  branchId: mainBranch.id,
  role: {
    id: "role_r",
    name: "RECEPTIONIST",
    permissions: ["attendance.mark", "attendance.view", "members.view"],
  },
};

const trainer: SessionUser = {
  ...testUser,
  branchId: mainBranch.id,
  role: { id: "role_t", name: "TRAINER", permissions: ["attendance.view", "members.view"] },
};

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: "01k4h0member0000000000001",
    organizationId: ORG,
    branchId: mainBranch.id,
    firstName: "Aarav",
    lastName: "Singh",
    phone: "+919000000001",
    email: null,
    dateOfBirth: null,
    status: "ACTIVE",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function attendance(overrides: Partial<Attendance> = {}): Attendance {
  return {
    id: "01k4h0attend000000000001",
    organizationId: ORG,
    branchId: mainBranch.id,
    memberId: "01k4h0member0000000000001",
    membershipId: "01k4h0mship00000000000001",
    checkedInAt: "2026-09-07T01:34:00.000Z", // 07:04 IST
    attendanceDate: TODAY,
    overrideReason: null,
    isOverride: false,
    markedByUserId: receptionist.id,
    member: {
      id: "01k4h0member0000000000001",
      firstName: "Aarav",
      lastName: "Singh",
      phone: "+919000000001",
    },
    branch: { id: mainBranch.id, name: mainBranch.name },
    membership: {
      id: "01k4h0mship00000000000001",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      status: "ACTIVE",
    },
    markedBy: { id: receptionist.id, name: "Priya at the desk" },
    ...overrides,
  };
}

function renderPage(user: SessionUser = receptionist, route = "/attendance") {
  useSessionStore.getState().setSession({
    user,
    organization: testOrganization,
    branches: [mainBranch],
  });
  return renderWithProviders(<AttendancePage />, { route });
}

function replyRegister(items: Attendance[], total = items.length) {
  mock.onGet(ATTENDANCE_PATH).reply(200, {
    success: true,
    data: items,
    pagination: { page: 1, limit: 20, total, totalPages: Math.max(1, Math.ceil(total / 20)) },
  });
}

function replyToday(count: number, date = TODAY) {
  mock.onGet(TODAY_PATH).reply(200, { success: true, data: { date, count } });
}

function replyMembers(items: Member[]) {
  mock.onGet(MEMBERS_PATH).reply(200, {
    success: true,
    data: items,
    pagination: { page: 1, limit: 8, total: items.length, totalPages: 1 },
  });
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
});

afterEach(() => {
  mock.restore();
});

describe("AttendancePage — the register", () => {
  it("shows the gym's today and headcount, not the browser's", async () => {
    replyToday(12);
    replyRegister([attendance()]);
    renderPage();

    const banner = await screen.findByTestId("today-banner");
    // 7 September 2026 is a Monday. Rendered from the server's date string, so a browser in any
    // timezone reads the same day.
    expect(banner).toHaveTextContent("Monday, 7 September 2026");
    expect(banner).toHaveTextContent("12 members have checked in");
  });

  it("renders arrival times in the gym's timezone", async () => {
    replyToday(1);
    replyRegister([attendance()]);
    renderPage();

    const row = await screen.findByTestId("attendance-row");
    // 01:34 UTC is 07:04 in Asia/Kolkata — the opening-hour slot 1.17.4 is about.
    expect(within(row).getByText(/7:04 am/i)).toBeInTheDocument();
    expect(within(row).getByText("Aarav Singh")).toBeInTheDocument();
    expect(within(row).getByText("Andheri")).toBeInTheDocument();
    expect(within(row).getByText("Priya at the desk")).toBeInTheDocument();
  });

  it("marks a covered visit as covered and an override with its reason", async () => {
    replyToday(2);
    replyRegister([
      attendance(),
      attendance({
        id: "01k4h0attend000000000002",
        memberId: "01k4h0member0000000000002",
        membershipId: null,
        membership: null,
        overrideReason: "FROZEN",
        isOverride: true,
        member: {
          id: "01k4h0member0000000000002",
          firstName: "Meera",
          lastName: "Rao",
          phone: "+919000000002",
        },
      }),
    ]);
    renderPage();

    await screen.findByTestId("coverage-covered");
    expect(screen.getByTestId("coverage-override")).toHaveTextContent("Override · Frozen");
  });

  it("filters to overrides only, and says so when there are none", async () => {
    replyToday(3);
    replyRegister([]);
    renderPage();

    await screen.findByTestId("attendance-table");
    await userEvent.selectOptions(screen.getByTestId("attendance-coverage"), "overrides");

    expect(
      await screen.findByText(/no overrides on this day — everyone who came in was covered/i),
    ).toBeInTheDocument();

    await waitFor(() => {
      const last = mock.history.get.filter((r) => r.url === ATTENDANCE_PATH).at(-1);
      expect(last?.params).toMatchObject({ overridesOnly: "true" });
    });
  });

  it("keeps the date filter in the URL so a day can be shared, and pages without losing it", async () => {
    replyToday(0);
    replyRegister([attendance()], 60);
    renderPage();

    await screen.findByTestId("attendance-table");
    // `fireEvent` rather than `userEvent.type`: a controlled date input reports "" for every
    // half-typed value, which would bounce the filter back to today between keystrokes.
    fireEvent.change(screen.getByTestId("attendance-date"), { target: { value: "2026-09-01" } });

    await waitFor(() => {
      const last = mock.history.get.filter((r) => r.url === ATTENDANCE_PATH).at(-1);
      expect(last?.params).toMatchObject({ date: "2026-09-01" });
    });

    // Paging must not wipe the day being looked at — the register would jump back to today.
    await userEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => {
      const last = mock.history.get.filter((r) => r.url === ATTENDANCE_PATH).at(-1);
      expect(last?.params).toMatchObject({ date: "2026-09-01", page: 2 });
    });
  });
});

describe("AttendancePage — checking someone in", () => {
  it("records a covered member and reports the time", async () => {
    replyToday(0);
    replyRegister([]);
    replyMembers([member()]);
    mock.onPost(ATTENDANCE_PATH).reply(201, {
      success: true,
      data: { attendance: attendance(), alreadyCheckedIn: false },
    });

    renderPage();
    await userEvent.type(screen.getByTestId("check-in-search"), "Aarav");

    await userEvent.click(await screen.findByTestId("check-in-01k4h0member0000000000001"));

    const outcome = await screen.findByTestId("check-in-outcome");
    expect(outcome).toHaveTextContent("Aarav Singh");
    expect(outcome).toHaveTextContent("checked in at 7:04 am");

    // The branch is sent from the session, never chosen by the member.
    const posted = JSON.parse(mock.history.post[0]!.data as string);
    expect(posted).toMatchObject({
      memberId: "01k4h0member0000000000001",
      branchId: mainBranch.id,
      override: false,
    });
  });

  it("asks before recording a member nothing covers, and only overrides when told", async () => {
    replyToday(0);
    replyRegister([]);
    replyMembers([member()]);

    mock
      .onPost(ATTENDANCE_PATH)
      .replyOnce(409, {
        success: false,
        error: {
          code: "MEMBERSHIP_NOT_ACTIVE",
          message: "Aarav's membership has expired — renew it, or check them in as an override",
          details: { reason: "EXPIRED", requiresOverride: true },
        },
      })
      .onPost(ATTENDANCE_PATH)
      .reply(201, {
        success: true,
        data: {
          attendance: attendance({
            membershipId: null,
            membership: null,
            overrideReason: "EXPIRED",
            isOverride: true,
          }),
          alreadyCheckedIn: false,
        },
      });

    renderPage();
    await userEvent.type(screen.getByTestId("check-in-search"), "Aarav");
    await userEvent.click(await screen.findByTestId("check-in-01k4h0member0000000000001"));

    const confirm = await screen.findByTestId("override-confirm");
    expect(confirm).toHaveTextContent("Expired");
    expect(confirm).toHaveTextContent(/membership has expired/i);
    expect(confirm).toHaveTextContent(/recorded as an override against your name/i);

    // The first attempt did not carry the override — the refusal is what prompts it.
    expect(JSON.parse(mock.history.post[0]!.data as string).override).toBe(false);

    await userEvent.click(screen.getByTestId("override-confirm-button"));

    const outcome = await screen.findByTestId("check-in-outcome");
    expect(outcome).toHaveTextContent(/recorded as an override/i);
    expect(JSON.parse(mock.history.post[1]!.data as string).override).toBe(true);
  });

  it("lets the desk back out of an override without recording anything", async () => {
    replyToday(0);
    replyRegister([]);
    replyMembers([member()]);
    mock.onPost(ATTENDANCE_PATH).reply(409, {
      success: false,
      error: {
        code: "MEMBERSHIP_NOT_ACTIVE",
        message: "Aarav has no membership",
        details: { reason: "NO_MEMBERSHIP", requiresOverride: true },
      },
    });

    renderPage();
    await userEvent.type(screen.getByTestId("check-in-search"), "Aarav");
    await userEvent.click(await screen.findByTestId("check-in-01k4h0member0000000000001"));

    await screen.findByTestId("override-confirm");
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByTestId("override-confirm")).not.toBeInTheDocument();
    expect(screen.queryByTestId("check-in-outcome")).not.toBeInTheDocument();
    expect(mock.history.post).toHaveLength(1);
  });

  it("says a repeat check-in changed nothing rather than showing an error", async () => {
    replyToday(1);
    replyRegister([attendance()]);
    replyMembers([member()]);
    mock.onPost(ATTENDANCE_PATH).reply(200, {
      success: true,
      data: { attendance: attendance(), alreadyCheckedIn: true },
    });

    renderPage();
    await userEvent.type(screen.getByTestId("check-in-search"), "Aarav");
    await userEvent.click(await screen.findByTestId("check-in-01k4h0member0000000000001"));

    const outcome = await screen.findByTestId("check-in-outcome");
    expect(outcome).toHaveTextContent(/already checked in today at 7:04 am/i);
    expect(outcome).toHaveTextContent(/nothing was recorded twice/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces a real failure as an error rather than an override prompt", async () => {
    replyToday(0);
    replyRegister([]);
    replyMembers([member()]);
    mock.onPost(ATTENDANCE_PATH).reply(404, {
      success: false,
      error: { code: "MEMBER_NOT_FOUND", message: "Member not found" },
    });

    renderPage();
    await userEvent.type(screen.getByTestId("check-in-search"), "Aarav");
    await userEvent.click(await screen.findByTestId("check-in-01k4h0member0000000000001"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Member not found");
    expect(screen.queryByTestId("override-confirm")).not.toBeInTheDocument();
  });

  it("searches only once the desk has typed, and only once per pause", async () => {
    replyToday(0);
    replyRegister([]);
    replyMembers([member()]);

    renderPage();
    await screen.findByTestId("attendance-table");
    // Nothing typed, nothing fetched — the roster is not a default answer.
    expect(mock.history.get.filter((r) => r.url === MEMBERS_PATH)).toHaveLength(0);

    await userEvent.type(screen.getByTestId("check-in-search"), "Aarav");

    await screen.findByTestId("check-in-result");
    // Five keystrokes, one request.
    expect(mock.history.get.filter((r) => r.url === MEMBERS_PATH)).toHaveLength(1);
  });
});

describe("AttendancePage — RBAC (Section 4.2)", () => {
  it("gives a TRAINER the register but no way to check anyone in", async () => {
    replyToday(4);
    replyRegister([attendance()]);
    renderPage(trainer);

    await screen.findByTestId("attendance-table");
    expect(screen.getByTestId("own-roster-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("check-in-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("check-in-search")).not.toBeInTheDocument();
  });

  it("gives a RECEPTIONIST both, and no branch picker to get wrong", async () => {
    replyToday(4);
    replyRegister([attendance()]);
    replyMembers([]);
    renderPage();

    expect(await screen.findByTestId("check-in-panel")).toHaveTextContent("Andheri");
    // Branch-scoped staff don't choose: `tenantScope` would reject another branch anyway (1.17.3).
    expect(screen.queryByTestId("attendance-branch")).not.toBeInTheDocument();
  });
});
