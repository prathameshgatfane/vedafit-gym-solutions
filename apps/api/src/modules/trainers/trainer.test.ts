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
import { localCalendarDate } from "../../utils/dates";

let tenant: TestTenant;
let otherBranch: { id: string };
let owner: TestActor;
let manager: TestActor;
let receptionist: TestActor;
let trainer: TestActor;
let otherTrainer: TestActor;
let accountant: TestActor;

function url(actor: TestActor, suffix = "") {
  return `/api/v1/organizations/${actor.organization.id}/trainers${suffix}`;
}

async function createMember(branchId?: string) {
  const suffix = generateId().slice(-8);
  return prisma.member.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      branchId: branchId ?? tenant.branch.id,
      firstName: "M",
      lastName: suffix,
      phone: `+9193${suffix}`,
    },
  });
}

beforeAll(async () => {
  tenant = await createTestTenant("Trainers");
  otherBranch = await prisma.branch.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      name: `Other ${generateId().slice(-4)}`,
    },
  });
  owner = await createActor(tenant, "OWNER");
  manager = await createActor(tenant, "MANAGER");
  receptionist = await createActor(tenant, "RECEPTIONIST", { branchScoped: true });
  trainer = await createActor(tenant, "TRAINER", { branchScoped: true });
  otherTrainer = await createActor(tenant, "TRAINER", { branchScoped: true });
  accountant = await createActor(tenant, "ACCOUNTANT");
});

describe("POST /trainers — profile create (1.19.3)", () => {
  it("creates a profile for a TRAINER user and returns commission as a fixed-2 string", async () => {
    const res = await request(app)
      .post(url(manager))
      .set(...bearer(manager))
      .send({
        userId: trainer.user.id,
        specialization: "Strength",
        commissionPct: 10.5,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBe(trainer.user.id);
    expect(res.body.data.specialization).toBe("Strength");
    expect(res.body.data.commissionPct).toBe("10.50");
    expect(res.body.data.user.email).toBe(trainer.user.email);
    expect(res.body.data.id).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/);

    const row = await prisma.trainerProfile.findUnique({ where: { userId: trainer.user.id } });
    expect(row?.organizationId).toBe(tenant.organization.id);
  });

  it("refuses a second profile for the same user", async () => {
    const res = await request(app)
      .post(url(manager))
      .set(...bearer(manager))
      .send({ userId: trainer.user.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TRAINER_PROFILE_EXISTS");
  });

  it("refuses an OWNER — they hold trainers.manage, so they are not a candidate (1.19.3)", async () => {
    const res = await request(app)
      .post(url(manager))
      .set(...bearer(manager))
      .send({ userId: owner.user.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("USER_NOT_ELIGIBLE_TRAINER");
  });

  it("lists eligible candidates and omits anyone who already has a profile", async () => {
    const res = await request(app).get(url(manager, "/candidates")).set(...bearer(manager));
    expect(res.status).toBe(200);
    const ids = res.body.data.map((row: { id: string }) => row.id);
    expect(ids).toContain(otherTrainer.user.id);
    expect(ids).not.toContain(trainer.user.id);
    expect(ids).not.toContain(owner.user.id);
    expect(ids).not.toContain(manager.user.id);
  });
});

describe("PATCH /trainers/:id and assignment", () => {
  let profileId: string;
  let mine: { id: string; firstName: string };
  let theirs: { id: string };

  beforeAll(async () => {
    const listed = await request(app).get(url(manager)).set(...bearer(manager));
    profileId = listed.body.data.find((row: { userId: string }) => row.userId === trainer.user.id)
      .id;
    mine = await createMember();
    theirs = await createMember();
  });

  it("edits specialization and commission without touching the user", async () => {
    const res = await request(app)
      .patch(url(manager, `/${profileId}`))
      .set(...bearer(manager))
      .send({ specialization: "Hypertrophy", commissionPct: 12 });

    expect(res.status).toBe(200);
    expect(res.body.data.specialization).toBe("Hypertrophy");
    expect(res.body.data.commissionPct).toBe("12.00");
    expect(res.body.data.userId).toBe(trainer.user.id);
  });

  it("assigns a member, and a second assign is a no-op", async () => {
    const first = await request(app)
      .post(url(manager, `/${profileId}/members`))
      .set(...bearer(manager))
      .send({ memberId: mine.id });
    expect(first.status).toBe(200);
    expect(first.body.data.assignments).toHaveLength(1);
    expect(first.body.data.assignments[0].memberId).toBe(mine.id);

    const second = await request(app)
      .post(url(manager, `/${profileId}/members`))
      .set(...bearer(manager))
      .send({ memberId: mine.id });
    expect(second.status).toBe(200);
    expect(second.body.data.assignments).toHaveLength(1);

    const rows = await prisma.trainerAssignment.findMany({ where: { trainerProfileId: profileId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assignedByUserId).toBe(manager.user.id);
  });

  it("refuses an archived member", async () => {
    const archived = await createMember();
    await prisma.member.update({ where: { id: archived.id }, data: { status: "ARCHIVED" } });

    const res = await request(app)
      .post(url(manager, `/${profileId}/members`))
      .set(...bearer(manager))
      .send({ memberId: archived.id });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("MEMBER_NOT_FOUND");
  });

  it("unassigns and then 404s a second unassign", async () => {
    await request(app)
      .post(url(manager, `/${profileId}/members`))
      .set(...bearer(manager))
      .send({ memberId: theirs.id })
      .expect(200);

    const dropped = await request(app)
      .delete(url(manager, `/${profileId}/members/${theirs.id}`))
      .set(...bearer(manager));
    expect(dropped.status).toBe(200);
    expect(
      dropped.body.data.assignments.map((row: { memberId: string }) => row.memberId),
    ).not.toContain(theirs.id);

    const again = await request(app)
      .delete(url(manager, `/${profileId}/members/${theirs.id}`))
      .set(...bearer(manager));
    expect(again.status).toBe(404);
    expect(again.body.error.code).toBe("ASSIGNMENT_NOT_FOUND");
  });
});

describe("own-roster (1.19.1) — the filter, not the middleware", () => {
  let assigned: { id: string };
  let unassigned: { id: string };
  let assignedCheckIn: string;
  let unassignedCheckIn: string;

  beforeAll(async () => {
    assigned = await createMember();
    unassigned = await createMember();

    const profile = await prisma.trainerProfile.findUniqueOrThrow({
      where: { userId: trainer.user.id },
    });
    await prisma.trainerAssignment.create({
      data: {
        id: generateId(),
        organizationId: tenant.organization.id,
        trainerProfileId: profile.id,
        memberId: assigned.id,
        assignedByUserId: manager.user.id,
      },
    });

    const today = localCalendarDate(new Date(), "Asia/Kolkata");
    const a = await prisma.attendance.create({
      data: {
        id: generateId(),
        organizationId: tenant.organization.id,
        branchId: tenant.branch.id,
        memberId: assigned.id,
        attendanceDate: today,
        overrideReason: "NO_MEMBERSHIP",
        markedByUserId: receptionist.user.id,
      },
    });
    const b = await prisma.attendance.create({
      data: {
        id: generateId(),
        organizationId: tenant.organization.id,
        branchId: tenant.branch.id,
        memberId: unassigned.id,
        attendanceDate: today,
        overrideReason: "NO_MEMBERSHIP",
        markedByUserId: receptionist.user.id,
      },
    });
    assignedCheckIn = a.id;
    unassignedCheckIn = b.id;
  });

  it("lets a TRAINER list only assigned members, and 404 an unassigned one", async () => {
    const listed = await request(app)
      .get(`/api/v1/organizations/${tenant.organization.id}/members`)
      .set(...bearer(trainer));
    expect(listed.status).toBe(200);
    const ids = listed.body.data.map((row: { id: string }) => row.id);
    expect(ids).toContain(assigned.id);
    expect(ids).not.toContain(unassigned.id);

    const hidden = await request(app)
      .get(`/api/v1/organizations/${tenant.organization.id}/members/${unassigned.id}`)
      .set(...bearer(trainer));
    expect(hidden.status).toBe(404);
    expect(hidden.body.error.code).toBe("MEMBER_NOT_FOUND");

    const visible = await request(app)
      .get(`/api/v1/organizations/${tenant.organization.id}/members/${assigned.id}`)
      .set(...bearer(trainer));
    expect(visible.status).toBe(200);
  });

  it("lets a TRAINER see assigned check-ins and 404s everyone else's", async () => {
    const listed = await request(app)
      .get(`/api/v1/organizations/${tenant.organization.id}/attendance`)
      .set(...bearer(trainer));
    expect(listed.status).toBe(200);
    const ids = listed.body.data.map((row: { id: string }) => row.id);
    expect(ids).toContain(assignedCheckIn);
    expect(ids).not.toContain(unassignedCheckIn);

    const hidden = await request(app)
      .get(`/api/v1/organizations/${tenant.organization.id}/attendance/${unassignedCheckIn}`)
      .set(...bearer(trainer));
    expect(hidden.status).toBe(404);
    expect(hidden.body.error.code).toBe("ATTENDANCE_NOT_FOUND");

    const today = await request(app)
      .get(`/api/v1/organizations/${tenant.organization.id}/attendance/today`)
      .set(...bearer(trainer));
    expect(today.status).toBe(200);
    expect(today.body.data.count).toBe(1);
  });

  it("does not shrink a RECEPTIONIST's register — they hold attendance.mark", async () => {
    const listed = await request(app)
      .get(`/api/v1/organizations/${tenant.organization.id}/attendance`)
      .set(...bearer(receptionist));
    expect(listed.status).toBe(200);
    const ids = listed.body.data.map((row: { id: string }) => row.id);
    expect(ids).toContain(assignedCheckIn);
    expect(ids).toContain(unassignedCheckIn);
  });

  it("does not shrink an ACCOUNTANT's member list — they do not hold attendance.view", async () => {
    const listed = await request(app)
      .get(`/api/v1/organizations/${tenant.organization.id}/members`)
      .set(...bearer(accountant));
    expect(listed.status).toBe(200);
    const ids = listed.body.data.map((row: { id: string }) => row.id);
    expect(ids).toContain(assigned.id);
    expect(ids).toContain(unassigned.id);
  });

  it("counts only the roster on a TRAINER's dashboard widgets", async () => {
    const res = await request(app)
      .get(`/api/v1/organizations/${tenant.organization.id}/reports/dashboard`)
      .set(...bearer(trainer));
    expect(res.status).toBe(200);
    expect(res.body.data.widgets.members.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.widgets.attendance.count).toBe(1);

    const ownerDash = await request(app)
      .get(`/api/v1/organizations/${tenant.organization.id}/reports/dashboard`)
      .set(...bearer(owner));
    expect(ownerDash.body.data.widgets.attendance.count).toBeGreaterThan(
      res.body.data.widgets.attendance.count,
    );
  });

  it("a TRAINER with no profile sees an empty roster, not the gym", async () => {
    const listed = await request(app)
      .get(`/api/v1/organizations/${tenant.organization.id}/members`)
      .set(...bearer(otherTrainer));
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual([]);

    const attendance = await request(app)
      .get(`/api/v1/organizations/${tenant.organization.id}/attendance`)
      .set(...bearer(otherTrainer));
    expect(attendance.status).toBe(200);
    expect(attendance.body.data).toEqual([]);
  });
});

describe("trainers RBAC", () => {
  it("lets a MANAGER manage profiles and refuses a TRAINER, RECEPTIONIST and ACCOUNTANT", async () => {
    const ok = await request(app).get(url(manager)).set(...bearer(manager));
    expect(ok.status).toBe(200);

    for (const actor of [trainer, receptionist, accountant]) {
      const res = await request(app).get(url(actor)).set(...bearer(actor));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("PERMISSION_DENIED");
    }
  });

  it("rejects org A's token against org B's trainers", async () => {
    const stranger = await createTestTenant("TrainerCross");
    const res = await request(app)
      .get(`/api/v1/organizations/${stranger.organization.id}/trainers`)
      .set(...bearer(owner));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORG_MISMATCH");
  });
});
