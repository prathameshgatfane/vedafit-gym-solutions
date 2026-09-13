import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../../../test/helpers/app";
import {
  bearer,
  createActor,
  createTestTenant,
  type TestActor,
  type TestTenant,
} from "../../../test/helpers/auth";
import { generateId } from "../../lib/id";
import { prisma } from "../../lib/prisma";
import { addDays, formatCalendarDate, localCalendarDate } from "../../utils/dates";

/** The seeded default timezone. The gym's clock, which is the one attendance runs on (1.17.4). */
const GYM_TZ = "Asia/Kolkata";

const gymToday = () => localCalendarDate(new Date(), GYM_TZ);
const gymTodayString = () => formatCalendarDate(gymToday());

let tenant: TestTenant;
let owner: TestActor;
let manager: TestActor;
let receptionist: TestActor;
let trainer: TestActor;
let accountant: TestActor;
let plan: { id: string };

function url(actor: TestActor, suffix = "") {
  return `/api/v1/organizations/${actor.organization.id}/attendance${suffix}`;
}

async function createMember(overrides: { branchId?: string } = {}) {
  const suffix = generateId().slice(-9);
  return prisma.member.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      branchId: overrides.branchId ?? tenant.branch.id,
      firstName: "Gym",
      lastName: `Goer ${suffix.slice(-4)}`,
      phone: `+9196${suffix}`,
    },
  });
}

type TermOptions = {
  status?: "ACTIVE" | "EXPIRED" | "FROZEN" | "CANCELLED";
  startOffset?: number;
  endOffset?: number;
};

/**
 * Writes a term directly: these tests are about attendance, not about the sale that created it.
 *
 * Offsets are relative to the *gym's* today, not UTC's. Those are different dates for the hours
 * either side of UTC midnight — at 02:00 IST it is already tomorrow at the gym — and anchoring on
 * `todayUtc()` here makes "a term ending today" mean yesterday for five and a half hours a night.
 * That is 1.17.4's whole point, and the test has to hold the same clock the service does.
 */
async function giveTerm(memberId: string, options: TermOptions = {}) {
  const today = gymToday();
  return prisma.membership.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      branchId: tenant.branch.id,
      memberId,
      planId: plan.id,
      priceAtPurchase: 1000,
      durationDaysAtPurchase: 30,
      startDate: addDays(today, options.startOffset ?? -5),
      endDate: addDays(today, options.endOffset ?? 24),
      status: options.status ?? "ACTIVE",
      frozenAt: options.status === "FROZEN" ? new Date() : null,
    },
  });
}

interface MarkResult {
  attendance: {
    id: string;
    branchId: string;
    memberId: string;
    membershipId: string | null;
    attendanceDate: string;
    overrideReason: string | null;
    isOverride: boolean;
    markedByUserId: string | null;
  };
  alreadyCheckedIn: boolean;
}

async function mark(
  actor: TestActor,
  body: { memberId: string; branchId?: string; override?: boolean },
) {
  return request(app)
    .post(url(actor))
    .set(...bearer(actor))
    .send(body);
}

async function markOrThrow(
  actor: TestActor,
  body: { memberId: string; branchId?: string; override?: boolean },
): Promise<MarkResult> {
  const res = await mark(actor, body);
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`Check-in failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data as MarkResult;
}

beforeAll(async () => {
  tenant = await createTestTenant("Attendance");
  owner = await createActor(tenant, "OWNER");
  manager = await createActor(tenant, "MANAGER");
  receptionist = await createActor(tenant, "RECEPTIONIST", { branchScoped: true });
  trainer = await createActor(tenant, "TRAINER");
  accountant = await createActor(tenant, "ACCOUNTANT");

  plan = await prisma.membershipPlan.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      name: `Attendance Plan ${generateId().slice(-6)}`,
      price: 1000,
      durationDays: 30,
    },
  });
});

describe("attendance — checking in a covered member", () => {
  it("records the visit against the term that covers it", async () => {
    const member = await createMember();
    const term = await giveTerm(member.id);

    const res = await mark(owner, { memberId: member.id, branchId: tenant.branch.id });
    expect(res.status).toBe(201);

    const { attendance, alreadyCheckedIn } = res.body.data as MarkResult;
    expect(alreadyCheckedIn).toBe(false);
    expect(attendance).toMatchObject({
      memberId: member.id,
      membershipId: term.id,
      overrideReason: null,
      isOverride: false,
      branchId: tenant.branch.id,
    });

    const row = await prisma.attendance.findUniqueOrThrow({ where: { id: attendance.id } });
    expect(row.membershipId).toBe(term.id);
    expect(row.overrideReason).toBeNull();
    // Recorded from the JWT, never the body.
    expect(row.markedByUserId).toBe(owner.user.id);
  });

  it("stamps the organization's local calendar day, not the UTC one", async () => {
    const member = await createMember();
    await giveTerm(member.id);

    const { attendance } = await markOrThrow(owner, {
      memberId: member.id,
      branchId: tenant.branch.id,
    });

    // The seeded default is Asia/Kolkata; the API is the authority on what "today" is.
    const expected = gymToday();
    expect(attendance.attendanceDate).toBe(expected.toISOString().slice(0, 10));

    const row = await prisma.attendance.findUniqueOrThrow({ where: { id: attendance.id } });
    expect(row.attendanceDate.toISOString().slice(0, 10)).toBe(attendance.attendanceDate);
    // Both are stored: the instant and the day it counts as.
    expect(row.checkedInAt.getTime()).toBeGreaterThan(0);
  });

  it("counts a term that starts today and one that ends today as covering", async () => {
    const startsToday = await createMember();
    await giveTerm(startsToday.id, { startOffset: 0, endOffset: 29 });
    const first = await markOrThrow(owner, {
      memberId: startsToday.id,
      branchId: tenant.branch.id,
    });
    expect(first.attendance.isOverride).toBe(false);

    // Inclusive on the last day too — 1.15's terms are inclusive at both ends.
    const endsToday = await createMember();
    await giveTerm(endsToday.id, { startOffset: -29, endOffset: 0 });
    const second = await markOrThrow(owner, {
      memberId: endsToday.id,
      branchId: tenant.branch.id,
    });
    expect(second.attendance.isOverride).toBe(false);
  });
});

describe("attendance — no covering membership (1.17.1)", () => {
  it("refuses once with MEMBERSHIP_NOT_ACTIVE and writes nothing", async () => {
    const member = await createMember();

    const res = await mark(owner, { memberId: member.id, branchId: tenant.branch.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("MEMBERSHIP_NOT_ACTIVE");
    expect(res.body.error.details).toMatchObject({
      reason: "NO_MEMBERSHIP",
      requiresOverride: true,
    });
    expect(await prisma.attendance.count({ where: { memberId: member.id } })).toBe(0);
  });

  it("records it when the caller says override, flagged with the reason", async () => {
    const member = await createMember();

    const { attendance } = await markOrThrow(owner, {
      memberId: member.id,
      branchId: tenant.branch.id,
      override: true,
    });

    expect(attendance).toMatchObject({
      membershipId: null,
      overrideReason: "NO_MEMBERSHIP",
      isOverride: true,
    });

    const row = await prisma.attendance.findUniqueOrThrow({ where: { id: attendance.id } });
    expect(row.overrideReason).toBe("NO_MEMBERSHIP");
    expect(row.membershipId).toBeNull();
    // Who waved them through is the point of recording it at all.
    expect(row.markedByUserId).toBe(owner.user.id);
  });

  it("names FROZEN rather than lumping it in with no-membership", async () => {
    const member = await createMember();
    await giveTerm(member.id, { status: "FROZEN" });

    const refused = await mark(owner, { memberId: member.id, branchId: tenant.branch.id });
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.reason).toBe("FROZEN");
    expect(refused.body.error.message).toMatch(/frozen/i);

    const { attendance } = await markOrThrow(owner, {
      memberId: member.id,
      branchId: tenant.branch.id,
      override: true,
    });
    expect(attendance.overrideReason).toBe("FROZEN");
  });

  it("names EXPIRED for a lapsed term still stored as ACTIVE, and leaves the row alone", async () => {
    const member = await createMember();
    // Left ACTIVE in the database though the calendar says otherwise — the state a member ends up
    // in whenever nobody has read their membership since it lapsed.
    const stale = await giveTerm(member.id, { startOffset: -60, endOffset: -30 });

    const refused = await mark(owner, { memberId: member.id, branchId: tenant.branch.id });
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.reason).toBe("EXPIRED");

    // The date predicate is what refused them, not the stored status — so attendance never has to
    // write to `memberships`, and can't expire a term on its own local clock a day early.
    const untouched = await prisma.membership.findUniqueOrThrow({ where: { id: stale.id } });
    expect(untouched.status).toBe("ACTIVE");
  });

  it("names CANCELLED for a cancelled term", async () => {
    const member = await createMember();
    await giveTerm(member.id, { status: "CANCELLED" });

    const refused = await mark(owner, { memberId: member.id, branchId: tenant.branch.id });
    expect(refused.body.error.details.reason).toBe("CANCELLED");
  });

  it("names NOT_STARTED for a term bought early that hasn't begun", async () => {
    const member = await createMember();
    await giveTerm(member.id, { startOffset: 10, endOffset: 40 });

    const refused = await mark(owner, { memberId: member.id, branchId: tenant.branch.id });
    expect(refused.body.error.details.reason).toBe("NOT_STARTED");
    expect(refused.body.error.message).toMatch(/hasn't started/i);
  });

  it("does not need an override once a real term covers the member", async () => {
    const member = await createMember();
    await giveTerm(member.id, { status: "CANCELLED" });
    await giveTerm(member.id);

    const res = await mark(owner, { memberId: member.id, branchId: tenant.branch.id });
    expect(res.status).toBe(201);
    expect((res.body.data as MarkResult).attendance.isOverride).toBe(false);
  });
});

describe("attendance — duplicates (1.17.2)", () => {
  it("returns the original row on a second check-in instead of erroring", async () => {
    const member = await createMember();
    await giveTerm(member.id);

    const first = await mark(owner, { memberId: member.id, branchId: tenant.branch.id });
    expect(first.status).toBe(201);
    expect(first.body.data.alreadyCheckedIn).toBe(false);

    const second = await mark(owner, { memberId: member.id, branchId: tenant.branch.id });
    expect(second.status).toBe(200);
    expect(second.body.data.alreadyCheckedIn).toBe(true);
    expect(second.body.data.attendance.id).toBe(first.body.data.attendance.id);
    // The time stays that of the first visit — the question it answers is when they arrive.
    expect(second.body.data.attendance.checkedInAt).toBe(first.body.data.attendance.checkedInAt);

    expect(await prisma.attendance.count({ where: { memberId: member.id } })).toBe(1);
  });

  it("survives simultaneous double-taps with exactly one row", async () => {
    const member = await createMember();
    await giveTerm(member.id);

    // The real shape of a double-click on a slow connection: both transactions see no existing
    // row, so only the unique index can decide this.
    const results = await Promise.all([
      mark(owner, { memberId: member.id, branchId: tenant.branch.id }),
      mark(owner, { memberId: member.id, branchId: tenant.branch.id }),
      mark(owner, { memberId: member.id, branchId: tenant.branch.id }),
    ]);

    expect(await prisma.attendance.count({ where: { memberId: member.id } })).toBe(1);
    // Nobody gets a 500: a loser either reads the winner's row or is refused cleanly.
    for (const res of results) {
      expect([200, 201, 409]).toContain(res.status);
    }
    expect(results.some((r) => r.status === 201)).toBe(true);
  });

  it("does not re-ask the membership question on a repeat check-in", async () => {
    const member = await createMember();
    const term = await giveTerm(member.id);

    await markOrThrow(owner, { memberId: member.id, branchId: tenant.branch.id });

    // The term is cancelled between the two taps. The second is still a no-op, not a refusal —
    // the coverage decision was settled when they walked in.
    await prisma.membership.update({ where: { id: term.id }, data: { status: "CANCELLED" } });

    const second = await mark(owner, { memberId: member.id, branchId: tenant.branch.id });
    expect(second.status).toBe(200);
    expect(second.body.data.alreadyCheckedIn).toBe(true);
    expect(second.body.data.attendance.membershipId).toBe(term.id);
  });

  it("lets the same member check in again on a different day", async () => {
    const member = await createMember();
    await giveTerm(member.id);

    const { attendance } = await markOrThrow(owner, {
      memberId: member.id,
      branchId: tenant.branch.id,
    });

    // Backdated by hand — the alternative is waiting until tomorrow.
    await prisma.attendance.update({
      where: { id: attendance.id },
      data: { attendanceDate: addDays(gymToday(), -1) },
    });

    const res = await mark(owner, { memberId: member.id, branchId: tenant.branch.id });
    expect(res.status).toBe(201);
    expect(await prisma.attendance.count({ where: { memberId: member.id } })).toBe(2);
  });
});

describe("attendance — branch scoping (1.17.3)", () => {
  it("stamps the branch the check-in happened at, not the member's home branch", async () => {
    const otherBranch = await prisma.branch.create({
      data: {
        id: generateId(),
        organizationId: tenant.organization.id,
        name: `Second ${generateId().slice(-5)}`,
      },
    });

    const member = await createMember(); // home branch is tenant.branch
    await giveTerm(member.id);

    const { attendance } = await markOrThrow(owner, {
      memberId: member.id,
      branchId: otherBranch.id,
    });

    expect(attendance.branchId).toBe(otherBranch.id);
    expect(attendance.branchId).not.toBe(tenant.branch.id);
  });

  it("makes an org-wide caller name a branch rather than guessing one", async () => {
    const member = await createMember();
    await giveTerm(member.id);

    const res = await mark(owner, { memberId: member.id });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BRANCH_REQUIRED");
    expect(await prisma.attendance.count({ where: { memberId: member.id } })).toBe(0);
  });

  it("pins a branch-scoped caller to their own branch without being told", async () => {
    const member = await createMember();
    await giveTerm(member.id);

    const { attendance } = await markOrThrow(receptionist, { memberId: member.id });
    expect(attendance.branchId).toBe(tenant.branch.id);
  });

  it("rejects a branch-scoped caller naming someone else's branch", async () => {
    const otherBranch = await prisma.branch.create({
      data: {
        id: generateId(),
        organizationId: tenant.organization.id,
        name: `Third ${generateId().slice(-5)}`,
      },
    });
    const member = await createMember();
    await giveTerm(member.id);

    const res = await mark(receptionist, { memberId: member.id, branchId: otherBranch.id });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("BRANCH_MISMATCH");
    expect(await prisma.attendance.count({ where: { memberId: member.id } })).toBe(0);
  });

  it("refuses a branch belonging to another organization", async () => {
    const otherTenant = await createTestTenant("Foreign");
    const member = await createMember();
    await giveTerm(member.id);

    const res = await mark(owner, { memberId: member.id, branchId: otherTenant.branch.id });
    expect(res.status).toBe(404);
  });

  it("hides another branch's member from a branch-scoped caller", async () => {
    const otherBranch = await prisma.branch.create({
      data: {
        id: generateId(),
        organizationId: tenant.organization.id,
        name: `Fourth ${generateId().slice(-5)}`,
      },
    });
    const member = await createMember({ branchId: otherBranch.id });
    await giveTerm(member.id);

    const res = await mark(receptionist, { memberId: member.id });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("MEMBER_NOT_FOUND");
  });
});

describe("attendance — the register", () => {
  it("lists a day's check-ins and filters to overrides only", async () => {
    const listTenantBranch = tenant.branch.id;
    const covered = await createMember();
    await giveTerm(covered.id);
    await markOrThrow(owner, { memberId: covered.id, branchId: listTenantBranch });

    const uncovered = await createMember();
    await markOrThrow(owner, {
      memberId: uncovered.id,
      branchId: listTenantBranch,
      override: true,
    });

    const today = gymTodayString();

    const all = await request(app)
      .get(url(owner))
      .query({ date: today, branchId: listTenantBranch, limit: 100 })
      .set(...bearer(owner));
    expect(all.status).toBe(200);
    const ids = all.body.data.map((a: { memberId: string }) => a.memberId);
    expect(ids).toContain(covered.id);
    expect(ids).toContain(uncovered.id);

    const overrides = await request(app)
      .get(url(owner))
      .query({ date: today, branchId: listTenantBranch, overridesOnly: "true", limit: 100 })
      .set(...bearer(owner));
    const overrideIds = overrides.body.data.map((a: { memberId: string }) => a.memberId);
    expect(overrideIds).toContain(uncovered.id);
    expect(overrideIds).not.toContain(covered.id);
  });

  it("finds a member's own history by memberId and by search", async () => {
    const member = await createMember();
    await giveTerm(member.id);
    await markOrThrow(owner, { memberId: member.id, branchId: tenant.branch.id });

    const byMember = await request(app)
      .get(url(owner))
      .query({ memberId: member.id })
      .set(...bearer(owner));
    expect(byMember.body.pagination.total).toBe(1);

    const bySearch = await request(app)
      .get(url(owner))
      .query({ search: member.phone, limit: 100 })
      .set(...bearer(owner));
    expect(bySearch.body.data.map((a: { memberId: string }) => a.memberId)).toContain(member.id);
  });

  it("excludes days outside the requested range", async () => {
    const member = await createMember();
    await giveTerm(member.id);
    const { attendance } = await markOrThrow(owner, {
      memberId: member.id,
      branchId: tenant.branch.id,
    });

    await prisma.attendance.update({
      where: { id: attendance.id },
      data: { attendanceDate: addDays(gymToday(), -10) },
    });

    const inRange = await request(app)
      .get(url(owner))
      .query({
        memberId: member.id,
        dateFrom: formatCalendarDate(addDays(gymToday(), -14)),
        dateTo: formatCalendarDate(addDays(gymToday(), -7)),
      })
      .set(...bearer(owner));
    expect(inRange.body.pagination.total).toBe(1);

    const outOfRange = await request(app)
      .get(url(owner))
      .query({
        memberId: member.id,
        dateFrom: formatCalendarDate(addDays(gymToday(), -3)),
      })
      .set(...bearer(owner));
    expect(outOfRange.body.pagination.total).toBe(0);
  });

  it("scopes a branch-scoped caller's register to their own branch", async () => {
    const otherBranch = await prisma.branch.create({
      data: {
        id: generateId(),
        organizationId: tenant.organization.id,
        name: `Fifth ${generateId().slice(-5)}`,
      },
    });
    const member = await createMember();
    await giveTerm(member.id);
    const { attendance } = await markOrThrow(owner, {
      memberId: member.id,
      branchId: otherBranch.id,
    });

    // Their own register comes back scoped, without them asking for it.
    const own = await request(app)
      .get(url(receptionist))
      .query({ limit: 100 })
      .set(...bearer(receptionist));

    expect(own.status).toBe(200);
    const branches = own.body.data.map((a: { branchId: string }) => a.branchId);
    expect(branches.every((b: string) => b === tenant.branch.id)).toBe(true);
    expect(own.body.data.map((a: { id: string }) => a.id)).not.toContain(attendance.id);

    // And asking for another branch is refused outright rather than quietly ignored — Phase 2's
    // `tenantScope` gets there before the handler does.
    const other = await request(app)
      .get(url(receptionist))
      .query({ branchId: otherBranch.id })
      .set(...bearer(receptionist));

    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe("BRANCH_MISMATCH");
  });

  it("reports today's date and headcount from the server, in the gym's timezone", async () => {
    const res = await request(app)
      .get(url(owner, "/today"))
      .query({ branchId: tenant.branch.id })
      .set(...bearer(owner));

    expect(res.status).toBe(200);
    expect(res.body.data.date).toBe(
      gymTodayString(),
    );

    const dbCount = await prisma.attendance.count({
      where: {
        organizationId: tenant.organization.id,
        branchId: tenant.branch.id,
        attendanceDate: gymToday(),
      },
    });
    expect(res.body.data.count).toBe(dbCount);
  });

  it("404s on another organization's attendance row", async () => {
    const member = await createMember();
    await giveTerm(member.id);
    const { attendance } = await markOrThrow(owner, {
      memberId: member.id,
      branchId: tenant.branch.id,
    });

    const stranger = await createActor(await createTestTenant("Outsider"), "OWNER");
    const res = await request(app)
      .get(`/api/v1/organizations/${stranger.organization.id}/attendance/${attendance.id}`)
      .set(...bearer(stranger));

    expect(res.status).toBe(404);
  });

  it("has no update or delete route", async () => {
    const member = await createMember();
    await giveTerm(member.id);
    const { attendance } = await markOrThrow(owner, {
      memberId: member.id,
      branchId: tenant.branch.id,
    });

    const patched = await request(app)
      .patch(url(owner, `/${attendance.id}`))
      .set(...bearer(owner))
      .send({ memberId: member.id });
    expect(patched.status).toBe(404);

    const deleted = await request(app)
      .delete(url(owner, `/${attendance.id}`))
      .set(...bearer(owner));
    expect(deleted.status).toBe(404);

    expect(await prisma.attendance.findUnique({ where: { id: attendance.id } })).not.toBeNull();
  });
});

describe("attendance — RBAC (Section 4.2)", () => {
  it("lets a RECEPTIONIST both mark and read — marking without reading is not a job", async () => {
    const member = await createMember();
    await giveTerm(member.id);

    const marked = await mark(receptionist, { memberId: member.id });
    expect(marked.status).toBe(201);

    const listed = await request(app)
      .get(url(receptionist))
      .set(...bearer(receptionist));
    expect(listed.status).toBe(200);
  });

  it("lets a RECEPTIONIST record an override — the desk is who is standing there", async () => {
    const member = await createMember();

    const refused = await mark(receptionist, { memberId: member.id });
    expect(refused.status).toBe(409);

    const overridden = await mark(receptionist, { memberId: member.id, override: true });
    expect(overridden.status).toBe(201);
    expect(overridden.body.data.attendance.overrideReason).toBe("NO_MEMBERSHIP");
    // Recorded against the receptionist, which is the accountability the override buys.
    expect(overridden.body.data.attendance.markedByUserId).toBe(receptionist.user.id);
  });

  it("lets a MANAGER mark and view", async () => {
    const member = await createMember();
    await giveTerm(member.id);

    const marked = await mark(manager, { memberId: member.id, branchId: tenant.branch.id });
    expect(marked.status).toBe(201);

    const listed = await request(app)
      .get(url(manager))
      .set(...bearer(manager));
    expect(listed.status).toBe(200);
  });

  it("lets a TRAINER read but never mark", async () => {
    const member = await createMember();
    await giveTerm(member.id);

    const listed = await request(app)
      .get(url(trainer))
      .set(...bearer(trainer));
    expect(listed.status).toBe(200);

    const marked = await mark(trainer, { memberId: member.id, branchId: tenant.branch.id });
    expect(marked.status).toBe(403);
    expect(marked.body.error.code).toBe("PERMISSION_DENIED");
    expect(await prisma.attendance.count({ where: { memberId: member.id } })).toBe(0);
  });

  it("denies an ACCOUNTANT the module entirely — attendance is not their brief", async () => {
    const member = await createMember();
    await giveTerm(member.id);

    const listed = await request(app)
      .get(url(accountant))
      .set(...bearer(accountant));
    expect(listed.status).toBe(403);

    const marked = await mark(accountant, { memberId: member.id, branchId: tenant.branch.id });
    expect(marked.status).toBe(403);
  });

  it("requires authentication", async () => {
    const res = await request(app).get(url(owner));
    expect(res.status).toBe(401);
  });

  it("denies another organization's owner", async () => {
    const stranger = await createActor(await createTestTenant("Rival"), "OWNER");
    const res = await request(app)
      .get(url(owner))
      .set(...bearer(stranger));
    expect(res.status).toBe(403);
  });
});
