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
import { memberService } from "./member.service";

let tenant: TestTenant;
let owner: TestActor;
let receptionist: TestActor;

function membersUrl(actor: TestActor, suffix = "") {
  return `/api/v1/organizations/${actor.organization.id}/members${suffix}`;
}

function newMember(overrides: Record<string, unknown> = {}) {
  // Randomized so parallel test files can't collide on the org-wide phone uniqueness check.
  const unique = Math.floor(Math.random() * 1_000_000_000)
    .toString()
    .padStart(9, "0");
  return {
    firstName: "Asha",
    lastName: "Rao",
    phone: `+91${unique}`,
    email: `asha-${unique}@example.test`,
    branchId: tenant.branch.id,
    ...overrides,
  };
}

async function createMember(actor: TestActor, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(membersUrl(actor))
    .set(...bearer(actor))
    .send(newMember(overrides));

  if (res.status !== 201) {
    throw new Error(`Member create failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data as { id: string; phone: string; firstName: string; lastName: string };
}

beforeAll(async () => {
  tenant = await createTestTenant("Members");
  owner = await createActor(tenant, "OWNER");
  receptionist = await createActor(tenant, "RECEPTIONIST", { branchScoped: true });
});

describe("members module — create", () => {
  it("creates a member with a lowercase ULID id and ACTIVE status (happy path)", async () => {
    const res = await request(app)
      .post(membersUrl(owner))
      .set(...bearer(owner))
      .send(newMember({ firstName: "Nikhil", lastName: "Sharma", dateOfBirth: "1994-03-17" }));

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      firstName: "Nikhil",
      lastName: "Sharma",
      status: "ACTIVE",
      organizationId: tenant.organization.id,
      branchId: tenant.branch.id,
    });
    expect(res.body.data.id).toMatch(/^[0-9a-z]{26}$/);

    // Stored, not just echoed.
    const row = await prisma.member.findUnique({ where: { id: res.body.data.id } });
    expect(row?.firstName).toBe("Nikhil");
    expect(row?.deletedAt).toBeNull();
  });

  it("keeps a date of birth on its calendar date instead of drifting a timezone", async () => {
    const res = await request(app)
      .post(membersUrl(owner))
      .set(...bearer(owner))
      .send(newMember({ dateOfBirth: "1990-01-01" }));

    expect(res.status).toBe(201);
    expect(res.body.data.dateOfBirth).toBe("1990-01-01");

    const row = await prisma.member.findUnique({ where: { id: res.body.data.id } });
    expect(row?.dateOfBirth?.toISOString()).toBe("1990-01-01T00:00:00.000Z");
  });

  it("stores an omitted email as NULL rather than an empty string", async () => {
    const res = await request(app)
      .post(membersUrl(owner))
      .set(...bearer(owner))
      .send(newMember({ email: "" }));

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBeNull();
  });

  it("rejects a malformed phone number before it reaches the database", async () => {
    const res = await request(app)
      .post(membersUrl(owner))
      .set(...bearer(owner))
      .send(newMember({ phone: "not-a-phone" }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.phone).toBeDefined();
  });

  it("refuses a branch belonging to another organization", async () => {
    const other = await createTestTenant("Other");

    const res = await request(app)
      .post(membersUrl(owner))
      .set(...bearer(owner))
      .send(newMember({ branchId: other.branch.id }));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("BRANCH_NOT_FOUND");
  });
});

describe("members module — duplicate phone (Locked Decision 1.3)", () => {
  it("rejects a second active member with the same phone in the same org", async () => {
    const first = await createMember(owner, { firstName: "Ravi", lastName: "Kumar" });

    const res = await request(app)
      .post(membersUrl(owner))
      .set(...bearer(owner))
      .send(newMember({ phone: first.phone, firstName: "Someone", lastName: "Else" }));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_PHONE");
    // Friendly enough to act on: it names who already holds the number.
    expect(res.body.error.message).toContain("Ravi Kumar");
    expect(res.body.error.details.conflictingMemberId).toBe(first.id);

    const count = await prisma.member.count({
      where: { organizationId: tenant.organization.id, phone: first.phone },
    });
    expect(count).toBe(1);
  });

  it("allows the same phone in a different organization (uniqueness is per-org)", async () => {
    const first = await createMember(owner);
    const otherTenant = await createTestTenant("PhoneOther");
    const otherOwner = await createActor(otherTenant, "OWNER");

    const res = await request(app)
      .post(membersUrl(otherOwner))
      .set(...bearer(otherOwner))
      .send({
        firstName: "Same",
        lastName: "Number",
        phone: first.phone,
        branchId: otherTenant.branch.id,
      });

    expect(res.status).toBe(201);
  });

  it("frees the phone number once the original member is archived", async () => {
    const first = await createMember(owner);

    await request(app)
      .post(membersUrl(owner, `/${first.id}/archive`))
      .set(...bearer(owner))
      .expect(200);

    const res = await request(app)
      .post(membersUrl(owner))
      .set(...bearer(owner))
      .send(newMember({ phone: first.phone, firstName: "Returning", lastName: "Member" }));

    expect(res.status).toBe(201);
  });

  it("rejects an update that would take another active member's phone", async () => {
    const a = await createMember(owner, { firstName: "Anita", lastName: "Bose" });
    const b = await createMember(owner);

    const res = await request(app)
      .patch(membersUrl(owner, `/${b.id}`))
      .set(...bearer(owner))
      .send({ phone: a.phone });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_PHONE");
  });

  it("lets a member keep their own phone number on an unrelated update", async () => {
    const member = await createMember(owner);

    const res = await request(app)
      .patch(membersUrl(owner, `/${member.id}`))
      .set(...bearer(owner))
      .send({ phone: member.phone, firstName: "Renamed" });

    expect(res.status).toBe(200);
    expect(res.body.data.firstName).toBe("Renamed");
  });

  it("race condition: two concurrent creates with the same phone — exactly one wins", async () => {
    // The check-then-create window that Locked Decision 1.3's org row lock exists to close.
    const phone = `+9198${Date.now().toString().slice(-8)}`;
    const scope = { organizationId: tenant.organization.id, branchId: null };

    const results = await Promise.allSettled([
      memberService.create(scope, {
        firstName: "Racer",
        lastName: "One",
        phone,
        branchId: tenant.branch.id,
      }),
      memberService.create(scope, {
        firstName: "Racer",
        lastName: "Two",
        phone,
        branchId: tenant.branch.id,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "DUPLICATE_PHONE",
    });

    const stored = await prisma.member.count({
      where: { organizationId: tenant.organization.id, phone },
    });
    expect(stored).toBe(1);
  });
});

describe("members module — list (Section 1.9 convention)", () => {
  let listTenant: TestTenant;
  let listOwner: TestActor;

  beforeAll(async () => {
    // Its own tenant so the row set is exactly what these tests create.
    listTenant = await createTestTenant("Listing");
    listOwner = await createActor(listTenant, "OWNER");

    const people = [
      { firstName: "Aarav", lastName: "Singh", status: "ACTIVE" },
      { firstName: "Bhavna", lastName: "Singh", status: "ACTIVE" },
      { firstName: "Chetan", lastName: "Verma", status: "ACTIVE" },
      { firstName: "Divya", lastName: "Singh", status: "INACTIVE" },
      { firstName: "Esha", lastName: "Singh", status: "INACTIVE" },
      { firstName: "Farhan", lastName: "Khan", status: "ARCHIVED" },
      { firstName: "Gita", lastName: "Singh", status: "ARCHIVED" },
    ];

    for (const [index, person] of people.entries()) {
      const created = await prisma.member.create({
        data: {
          id: generateId(),
          organizationId: listTenant.organization.id,
          branchId: listTenant.branch.id,
          firstName: person.firstName,
          lastName: person.lastName,
          phone: `+9190000000${index.toString().padStart(2, "0")}`,
          status: person.status as "ACTIVE" | "INACTIVE" | "ARCHIVED",
        },
      });
      expect(created.id).toBeDefined();
    }
  });

  async function list(query: string) {
    const res = await request(app)
      .get(`/api/v1/organizations/${listTenant.organization.id}/members${query}`)
      .set(...bearer(listOwner));
    expect(res.status).toBe(200);
    return res.body as {
      data: { firstName: string; lastName: string; status: string }[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
  }

  it("hides archived members by default", async () => {
    const body = await list("");
    expect(body.pagination.total).toBe(5);
    expect(body.data.map((m) => m.firstName)).not.toContain("Farhan");
  });

  it("returns archived members only when asked for explicitly", async () => {
    const body = await list("?status=ARCHIVED");
    expect(body.pagination.total).toBe(2);
    expect(body.data.map((m) => m.firstName).sort()).toEqual(["Farhan", "Gita"]);
  });

  it("filters by status", async () => {
    const body = await list("?status=INACTIVE");
    expect(body.pagination.total).toBe(2);
    expect(body.data.every((m) => m.status === "INACTIVE")).toBe(true);
  });

  it("searches across first name, last name and phone", async () => {
    expect((await list("?search=Chetan")).pagination.total).toBe(1);
    expect((await list("?search=Singh")).pagination.total).toBe(4); // ARCHIVED Gita excluded
    expect((await list("?search=9000000002")).pagination.total).toBe(1);
  });

  it("sorts by the requested field and direction", async () => {
    const asc = await list("?sortBy=firstName&sortOrder=asc");
    expect(asc.data[0]?.firstName).toBe("Aarav");

    const desc = await list("?sortBy=firstName&sortOrder=desc");
    expect(desc.data[0]?.firstName).toBe("Esha");
  });

  it("paginates with correct metadata", async () => {
    const page1 = await list("?limit=2&page=1&sortBy=firstName");
    expect(page1.data.map((m) => m.firstName)).toEqual(["Aarav", "Bhavna"]);
    expect(page1.pagination).toMatchObject({ page: 1, limit: 2, total: 5, totalPages: 3 });

    const page3 = await list("?limit=2&page=3&sortBy=firstName");
    expect(page3.data.map((m) => m.firstName)).toEqual(["Esha"]);
  });

  it("combines search + status filter + pagination + sort in one query", async () => {
    // 5 non-archived members; 4 match "Singh"; 2 of those are INACTIVE (Divya, Esha).
    const page1 = await list("?search=Singh&status=INACTIVE&limit=1&page=1&sortBy=firstName&sortOrder=asc");
    expect(page1.pagination).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });
    expect(page1.data.map((m) => m.firstName)).toEqual(["Divya"]);

    const page2 = await list("?search=Singh&status=INACTIVE&limit=1&page=2&sortBy=firstName&sortOrder=asc");
    expect(page2.data.map((m) => m.firstName)).toEqual(["Esha"]);

    // Same filters, opposite order — page 1 must now be the other member, proving sort is
    // applied before the page is cut rather than after.
    const desc = await list("?search=Singh&status=INACTIVE&limit=1&page=1&sortBy=firstName&sortOrder=desc");
    expect(desc.data.map((m) => m.firstName)).toEqual(["Esha"]);
  });

  it("returns an empty page rather than an error past the end of the result set", async () => {
    const body = await list("?page=99");
    expect(body.data).toEqual([]);
    expect(body.pagination.total).toBe(5);
  });

  it("rejects an unsupported sort field instead of silently ignoring it", async () => {
    const res = await request(app)
      .get(`/api/v1/organizations/${listTenant.organization.id}/members?sortBy=passwordHash`)
      .set(...bearer(listOwner));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("members module — view, update, archive", () => {
  it("fetches a member by id", async () => {
    const member = await createMember(owner, { firstName: "Vikram" });

    const res = await request(app)
      .get(membersUrl(owner, `/${member.id}`))
      .set(...bearer(owner));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: member.id, firstName: "Vikram" });
  });

  it("404s on a member id from another organization", async () => {
    const otherTenant = await createTestTenant("ViewOther");
    const otherOwner = await createActor(otherTenant, "OWNER");
    const theirs = await createMember(otherOwner, { branchId: otherTenant.branch.id });

    const res = await request(app)
      .get(membersUrl(owner, `/${theirs.id}`))
      .set(...bearer(owner));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("MEMBER_NOT_FOUND");
  });

  it("updates fields and persists them", async () => {
    const member = await createMember(owner);

    const res = await request(app)
      .patch(membersUrl(owner, `/${member.id}`))
      .set(...bearer(owner))
      .send({ firstName: "Updated", status: "INACTIVE", dateOfBirth: "1988-12-25" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      firstName: "Updated",
      status: "INACTIVE",
      dateOfBirth: "1988-12-25",
    });

    const row = await prisma.member.findUnique({ where: { id: member.id } });
    expect(row?.firstName).toBe("Updated");
    expect(row?.status).toBe("INACTIVE");
  });

  it("clears an email when explicitly sent as null", async () => {
    const member = await createMember(owner);

    const res = await request(app)
      .patch(membersUrl(owner, `/${member.id}`))
      .set(...bearer(owner))
      .send({ email: null });

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBeNull();
  });

  it("rejects an empty update body", async () => {
    const member = await createMember(owner);

    const res = await request(app)
      .patch(membersUrl(owner, `/${member.id}`))
      .set(...bearer(owner))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("will not let ARCHIVED in through the update endpoint", async () => {
    // Otherwise `members.update` would be a back door around `members.archive`.
    const member = await createMember(owner);

    const res = await request(app)
      .patch(membersUrl(owner, `/${member.id}`))
      .set(...bearer(owner))
      .send({ status: "ARCHIVED" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("archives a member as a status change, leaving the row readable", async () => {
    const member = await createMember(owner);

    const res = await request(app)
      .post(membersUrl(owner, `/${member.id}/archive`))
      .set(...bearer(owner));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ARCHIVED");

    const row = await prisma.member.findUnique({ where: { id: member.id } });
    expect(row?.status).toBe("ARCHIVED");
    // Archive is not a delete — Section 9 (2026-09-06).
    expect(row?.deletedAt).toBeNull();

    const fetched = await request(app)
      .get(membersUrl(owner, `/${member.id}`))
      .set(...bearer(owner));
    expect(fetched.status).toBe(200);
  });

  it("is idempotent when archiving twice", async () => {
    const member = await createMember(owner);
    const url = membersUrl(owner, `/${member.id}/archive`);

    await request(app).post(url).set(...bearer(owner)).expect(200);
    const second = await request(app).post(url).set(...bearer(owner));

    expect(second.status).toBe(200);
    expect(second.body.data.status).toBe("ARCHIVED");
  });
});

describe("members module — RBAC (Section 4.2 matrix)", () => {
  it("lets a RECEPTIONIST create, view and update members", async () => {
    const created = await request(app)
      .post(membersUrl(receptionist))
      .set(...bearer(receptionist))
      .send(newMember({ firstName: "Walkin", lastName: "Signup" }));
    expect(created.status).toBe(201);

    const viewed = await request(app)
      .get(membersUrl(receptionist, `/${created.body.data.id}`))
      .set(...bearer(receptionist));
    expect(viewed.status).toBe(200);

    const listed = await request(app)
      .get(membersUrl(receptionist))
      .set(...bearer(receptionist));
    expect(listed.status).toBe(200);

    const updated = await request(app)
      .patch(membersUrl(receptionist, `/${created.body.data.id}`))
      .set(...bearer(receptionist))
      .send({ firstName: "Corrected" });
    expect(updated.status).toBe(200);
  });

  it("blocks a RECEPTIONIST from archiving", async () => {
    const member = await createMember(owner);

    const res = await request(app)
      .post(membersUrl(receptionist, `/${member.id}/archive`))
      .set(...bearer(receptionist));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PERMISSION_DENIED");

    // Rejected before the handler ran — the record is untouched.
    const row = await prisma.member.findUnique({ where: { id: member.id } });
    expect(row?.status).toBe("ACTIVE");
  });

  it("blocks a TRAINER from creating members but allows viewing", async () => {
    const trainer = await createActor(tenant, "TRAINER");

    const created = await request(app)
      .post(membersUrl(trainer))
      .set(...bearer(trainer))
      .send(newMember());
    expect(created.status).toBe(403);
    expect(created.body.error.code).toBe("PERMISSION_DENIED");

    const listed = await request(app)
      .get(membersUrl(trainer))
      .set(...bearer(trainer));
    expect(listed.status).toBe(200);
  });

  it("blocks an ACCOUNTANT from the module entirely", async () => {
    const accountant = await createActor(tenant, "ACCOUNTANT");

    const res = await request(app)
      .get(membersUrl(accountant))
      .set(...bearer(accountant));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("requires authentication", async () => {
    const res = await request(app).get(membersUrl(owner));
    expect(res.status).toBe(401);
  });
});

describe("members module — tenant and branch scoping", () => {
  it("denies org A's token against org B's members", async () => {
    const otherTenant = await createTestTenant("ScopeOther");
    const otherOwner = await createActor(otherTenant, "OWNER");

    const res = await request(app)
      .get(`/api/v1/organizations/${otherTenant.organization.id}/members`)
      .set(...bearer(owner));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORG_MISMATCH");

    // And the reverse direction.
    const reverse = await request(app)
      .get(membersUrl(owner))
      .set(...bearer(otherOwner));
    expect(reverse.status).toBe(403);
  });

  it("shows a branch-scoped user only their own branch's members", async () => {
    const secondBranch = await prisma.branch.create({
      data: { id: generateId(), organizationId: tenant.organization.id, name: "Second Branch" },
    });
    const marker = `Branchy${Date.now()}`;

    await createMember(owner, { firstName: marker, branchId: tenant.branch.id });
    await createMember(owner, { firstName: marker, branchId: secondBranch.id });

    const asOwner = await request(app)
      .get(membersUrl(owner, `?search=${marker}`))
      .set(...bearer(owner));
    expect(asOwner.body.pagination.total).toBe(2);

    // The receptionist is pinned to tenant.branch and never named a branch in the request —
    // without the service-side scope they would see both.
    const asReceptionist = await request(app)
      .get(membersUrl(receptionist, `?search=${marker}`))
      .set(...bearer(receptionist));
    expect(asReceptionist.body.pagination.total).toBe(1);
    expect(asReceptionist.body.data[0].branchId).toBe(tenant.branch.id);
  });

  it("stops a branch-scoped user naming another branch in the query", async () => {
    const secondBranch = await prisma.branch.create({
      data: { id: generateId(), organizationId: tenant.organization.id, name: "Third Branch" },
    });

    const res = await request(app)
      .get(membersUrl(receptionist, `?branchId=${secondBranch.id}`))
      .set(...bearer(receptionist));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("BRANCH_MISMATCH");
  });

  it("stops a branch-scoped user creating a member in another branch", async () => {
    const secondBranch = await prisma.branch.create({
      data: { id: generateId(), organizationId: tenant.organization.id, name: "Fourth Branch" },
    });

    const res = await request(app)
      .post(membersUrl(receptionist))
      .set(...bearer(receptionist))
      .send(newMember({ branchId: secondBranch.id }));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("BRANCH_MISMATCH");
  });

  it("404s a branch-scoped user fetching a member from another branch", async () => {
    const secondBranch = await prisma.branch.create({
      data: { id: generateId(), organizationId: tenant.organization.id, name: "Fifth Branch" },
    });
    const elsewhere = await createMember(owner, { branchId: secondBranch.id });

    const res = await request(app)
      .get(membersUrl(receptionist, `/${elsewhere.id}`))
      .set(...bearer(receptionist));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("MEMBER_NOT_FOUND");
  });
});
