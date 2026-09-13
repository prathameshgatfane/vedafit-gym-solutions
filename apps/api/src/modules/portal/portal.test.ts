import { Prisma } from "@prisma/client";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../../../test/helpers/app";
import {
  bearer,
  createActor,
  createTestTenant,
  TEST_PASSWORD,
  type TestActor,
  type TestTenant,
} from "../../../test/helpers/auth";
import { generateId } from "../../lib/id";
import { hashPassword } from "../../lib/password";
import { prisma } from "../../lib/prisma";
import { addDays, todayUtc } from "../../utils/dates";

let tenant: TestTenant;
let owner: TestActor;
let aliceToken: string;
let aliceRefresh: string;
let aliceId: string;
let bobId: string;
let otherTenant: TestTenant;

async function portalMember(firstName: string, phone: string) {
  return prisma.member.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      branchId: tenant.branch.id,
      firstName,
      lastName: "Portal",
      phone,
      passwordHash: await hashPassword(TEST_PASSWORD),
    },
  });
}

async function loginMember(phone: string) {
  const res = await request(app).post("/api/v1/auth/member/login").send({
    phone,
    password: TEST_PASSWORD,
    organizationSlug: tenant.organization.slug,
  });
  expect(res.status).toBe(200);
  return res.body.data as { accessToken: string; refreshToken: string; member: { id: string } };
}

beforeAll(async () => {
  tenant = await createTestTenant("Portal");
  owner = await createActor(tenant, "OWNER");
  otherTenant = await createTestTenant("OtherPortal");

  const alice = await portalMember("Alice", "+919111100001");
  const bob = await portalMember("Bob", "+919111100002");
  aliceId = alice.id;
  bobId = bob.id;

  const plan = await prisma.membershipPlan.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      name: "Portal Gold",
      price: new Prisma.Decimal("2000.00"),
      durationDays: 30,
    },
  });
  const today = todayUtc();
  const membership = await prisma.membership.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      branchId: tenant.branch.id,
      memberId: alice.id,
      planId: plan.id,
      priceAtPurchase: plan.price,
      durationDaysAtPurchase: 30,
      startDate: addDays(today, -5),
      endDate: addDays(today, 10),
      status: "ACTIVE",
    },
  });
  await prisma.membership.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      branchId: tenant.branch.id,
      memberId: bob.id,
      planId: plan.id,
      priceAtPurchase: plan.price,
      durationDaysAtPurchase: 30,
      startDate: addDays(today, -5),
      endDate: addDays(today, 10),
      status: "ACTIVE",
    },
  });

  await prisma.invoice.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      branchId: tenant.branch.id,
      memberId: alice.id,
      membershipId: membership.id,
      invoiceNumber: `INV-P13A-${generateId().slice(-6)}`,
      amountTotal: new Prisma.Decimal("2000.00"),
      amountPaid: new Prisma.Decimal("500.00"),
      amountPending: new Prisma.Decimal("1500.00"),
      status: "PARTIALLY_PAID",
    },
  });
  await prisma.invoice.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      branchId: tenant.branch.id,
      memberId: bob.id,
      invoiceNumber: `INV-P13B-${generateId().slice(-6)}`,
      amountTotal: new Prisma.Decimal("9999.00"),
      amountPaid: new Prisma.Decimal("0.00"),
      amountPending: new Prisma.Decimal("9999.00"),
      status: "UNPAID",
    },
  });

  await prisma.payment.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      branchId: tenant.branch.id,
      memberId: alice.id,
      membershipId: membership.id,
      amount: new Prisma.Decimal("500.00"),
      method: "UPI",
      status: "SUCCESS",
    },
  });
  await prisma.payment.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      branchId: tenant.branch.id,
      memberId: bob.id,
      amount: new Prisma.Decimal("111.00"),
      method: "CASH",
      status: "SUCCESS",
    },
  });

  await prisma.attendance.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      branchId: tenant.branch.id,
      memberId: alice.id,
      membershipId: membership.id,
      checkedInAt: new Date(),
      attendanceDate: today,
    },
  });
  await prisma.attendance.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      branchId: tenant.branch.id,
      memberId: bob.id,
      checkedInAt: new Date(),
      attendanceDate: today,
    },
  });

  const session = await loginMember("+919111100001");
  aliceToken = session.accessToken;
  aliceRefresh = session.refreshToken;
});

describe("member portal auth (1.23)", () => {
  it("logs in by phone + org slug and returns refreshToken in the body", async () => {
    expect(aliceToken).toBeTruthy();
    expect(aliceRefresh).toBeTruthy();
    const login = await request(app).post("/api/v1/auth/member/login").send({
      phone: "+919111100001",
      password: TEST_PASSWORD,
      organizationSlug: tenant.organization.slug,
    });
    expect(login.status).toBe(200);
    expect(login.body.data.refreshToken).toEqual(expect.any(String));
    expect(login.headers["set-cookie"]).toBeUndefined();
    const [, payload] = (login.body.data.accessToken as string).split(".");
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
    expect(claims.type).toBe("member_access");

    const me = await request(app)
      .get("/api/v1/auth/member/me")
      .set("Authorization", `Bearer ${aliceToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.member.id).toBe(aliceId);
    expect(me.body.data.member.passwordHash).toBeUndefined();
  });

  it("refuses a wrong password and a member with no portal hash", async () => {
    const wrong = await request(app).post("/api/v1/auth/member/login").send({
      phone: "+919111100001",
      password: "nope",
      organizationSlug: tenant.organization.slug,
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("INVALID_CREDENTIALS");

    await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: tenant.organization.id,
        branchId: tenant.branch.id,
        firstName: "No",
        lastName: "Portal",
        phone: "+919111100099",
      },
    });
    const locked = await request(app).post("/api/v1/auth/member/login").send({
      phone: "+919111100099",
      password: TEST_PASSWORD,
      organizationSlug: tenant.organization.slug,
    });
    expect(locked.status).toBe(401);
  });

  it("rotates the refresh token and rejects a staff JWT on /me", async () => {
    const refreshed = await request(app)
      .post("/api/v1/auth/member/refresh")
      .send({ refreshToken: aliceRefresh });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.refreshToken).toBeTruthy();
    expect(refreshed.body.data.refreshToken).not.toBe(aliceRefresh);

    const replay = await request(app)
      .post("/api/v1/auth/member/refresh")
      .send({ refreshToken: aliceRefresh });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("TOKEN_REUSE_DETECTED");

    // Reuse revokes the family, including the token we just issued — start a new session.
    const fresh = await loginMember("+919111100001");
    aliceToken = fresh.accessToken;
    aliceRefresh = fresh.refreshToken;

    const staffOnPortal = await request(app).get("/api/v1/me").set(...bearer(owner));
    expect(staffOnPortal.status).toBe(401);

    const memberOnStaff = await request(app)
      .get(`/api/v1/organizations/${tenant.organization.id}/members`)
      .set("Authorization", `Bearer ${aliceToken}`);
    expect(memberOnStaff.status).toBe(401);
  });
});

describe("member portal self-scope (1.23.3)", () => {
  it("returns Alice's membership, attendance and payment — never Bob's", async () => {
    const home = await request(app)
      .get("/api/v1/me")
      .set("Authorization", `Bearer ${aliceToken}`);
    expect(home.status).toBe(200);
    expect(home.body.data.member.id).toBe(aliceId);
    expect(home.body.data.currentMembership.memberId).toBe(aliceId);
    expect(home.body.data.currentMembership.daysRemaining).toBeGreaterThan(0);
    expect(home.body.data.outstandingPending).toBe("1500.00");

    const memberships = await request(app)
      .get("/api/v1/me/memberships")
      .set("Authorization", `Bearer ${aliceToken}`);
    expect(memberships.body.data.every((row: { memberId: string }) => row.memberId === aliceId)).toBe(
      true,
    );
    expect(memberships.body.data.some((row: { memberId: string }) => row.memberId === bobId)).toBe(
      false,
    );

    const payments = await request(app)
      .get("/api/v1/me/payments")
      .set("Authorization", `Bearer ${aliceToken}`);
    expect(payments.body.data).toHaveLength(1);
    expect(payments.body.data[0].amount).toBe("500.00");
    expect(payments.body.data.some((row: { amount: string }) => row.amount === "111.00")).toBe(false);

    const attendance = await request(app)
      .get("/api/v1/me/attendance")
      .set("Authorization", `Bearer ${aliceToken}`);
    expect(attendance.body.data).toHaveLength(1);
    expect(attendance.body.data[0].memberId).toBe(aliceId);
  });

  it("does not accept another organization's slug for the same phone", async () => {
    const res = await request(app).post("/api/v1/auth/member/login").send({
      phone: "+919111100001",
      password: TEST_PASSWORD,
      organizationSlug: otherTenant.organization.slug,
    });
    expect(res.status).toBe(401);
  });
});
