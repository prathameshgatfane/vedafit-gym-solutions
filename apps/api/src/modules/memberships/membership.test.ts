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
import { addDays, formatCalendarDate, todayUtc } from "../../utils/dates";

let tenant: TestTenant;
let owner: TestActor;
let receptionist: TestActor;
let manager: TestActor;
let trainer: TestActor;

const TODAY = todayUtc();
const day = (offset: number) => formatCalendarDate(addDays(TODAY, offset));

function url(actor: TestActor, suffix = "") {
  return `/api/v1/organizations/${actor.organization.id}/memberships${suffix}`;
}

async function createPlan(price = 1000, durationDays = 30) {
  return prisma.membershipPlan.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      name: `Plan ${generateId().slice(-8)}`,
      price,
      durationDays,
    },
  });
}

async function createMember(overrides: { branchId?: string; status?: "ACTIVE" | "ARCHIVED" } = {}) {
  const suffix = generateId().slice(-9);
  return prisma.member.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      branchId: overrides.branchId ?? tenant.branch.id,
      firstName: "Term",
      lastName: `Tester ${suffix.slice(-4)}`,
      phone: `+9198${suffix}`,
      status: overrides.status ?? "ACTIVE",
    },
  });
}

interface MembershipBody {
  id: string;
  memberId: string;
  planId: string;
  status: string;
  startDate: string;
  endDate: string;
  priceAtPurchase: string;
  durationDaysAtPurchase: number;
  totalFrozenDays: number;
  frozenAt: string | null;
  previousMembershipId: string | null;
  daysRemaining: number;
  isUpcoming: boolean;
  branchId: string;
}

async function sell(
  actor: TestActor,
  body: { memberId: string; planId: string; startDate?: string },
): Promise<MembershipBody> {
  const res = await request(app)
    .post(url(actor))
    .set(...bearer(actor))
    .send(body);

  if (res.status !== 201) {
    throw new Error(`Membership create failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data as MembershipBody;
}

/**
 * A member with one live term, which most transition tests need. `startOffset` backdates the
 * start so freeze tests can put `frozenAt` in the past without inventing a freeze that began
 * before the term did.
 */
async function sellFresh(price = 1000, durationDays = 30, startOffset = 0) {
  const [member, plan] = await Promise.all([createMember(), createPlan(price, durationDays)]);
  const membership = await sell(owner, {
    memberId: member.id,
    planId: plan.id,
    startDate: day(startOffset),
  });
  return { member, plan, membership };
}

beforeAll(async () => {
  tenant = await createTestTenant("Memberships");
  owner = await createActor(tenant, "OWNER");
  manager = await createActor(tenant, "MANAGER");
  receptionist = await createActor(tenant, "RECEPTIONIST", { branchScoped: true });
  trainer = await createActor(tenant, "TRAINER");
});

describe("memberships — create and snapshot pricing", () => {
  it("snapshots price and duration, and derives an inclusive end date", async () => {
    const { membership } = await sellFresh(1250.5, 30);

    expect(membership).toMatchObject({
      status: "ACTIVE",
      priceAtPurchase: "1250.50",
      durationDaysAtPurchase: 30,
      startDate: day(0),
      // 30 days of access starting today means the 30th day is the last one, not the 31st.
      endDate: day(29),
      totalFrozenDays: 0,
      frozenAt: null,
      previousMembershipId: null,
      isUpcoming: false,
      daysRemaining: 30,
    });
  });

  it("does not reprice an issued membership when the plan's price later changes", async () => {
    const { plan, membership } = await sellFresh(1000, 30);

    await request(app)
      .patch(`/api/v1/organizations/${tenant.organization.id}/membership-plans/${plan.id}`)
      .set(...bearer(owner))
      .send({ price: 9999, durationDays: 365 })
      .expect(200);

    const reread = await request(app)
      .get(url(owner, `/${membership.id}`))
      .set(...bearer(owner));

    expect(reread.body.data.priceAtPurchase).toBe("1000.00");
    expect(reread.body.data.durationDaysAtPurchase).toBe(30);
    expect(reread.body.data.endDate).toBe(day(29));

    // ...and the database agrees — this isn't a serializer holding an old value in memory.
    const row = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(row.priceAtPurchase.toFixed(2)).toBe("1000.00");
    expect(row.durationDaysAtPurchase).toBe(30);
  });

  it("takes the branch from the member rather than from the request body", async () => {
    const otherBranch = await prisma.branch.create({
      data: { id: generateId(), organizationId: tenant.organization.id, name: `B ${generateId().slice(-5)}` },
    });
    const member = await createMember({ branchId: otherBranch.id });
    const plan = await createPlan();

    const membership = await sell(owner, { memberId: member.id, planId: plan.id });
    expect(membership.branchId).toBe(otherBranch.id);
  });

  it("refuses to sell a retired plan", async () => {
    const member = await createMember();
    const plan = await createPlan();
    await prisma.membershipPlan.update({ where: { id: plan.id }, data: { status: "INACTIVE" } });

    const res = await request(app)
      .post(url(owner))
      .set(...bearer(owner))
      .send({ memberId: member.id, planId: plan.id });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MEMBERSHIP_PLAN_INACTIVE");
  });

  it("refuses to sell to an archived member", async () => {
    const member = await createMember({ status: "ARCHIVED" });
    const plan = await createPlan();

    const res = await request(app)
      .post(url(owner))
      .set(...bearer(owner))
      .send({ memberId: member.id, planId: plan.id });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/archived/i);
  });

  it("rejects a second overlapping term — one live membership per member (1.15.1)", async () => {
    const { member, plan } = await sellFresh();

    const res = await request(app)
      .post(url(owner))
      .set(...bearer(owner))
      .send({ memberId: member.id, planId: plan.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("MEMBERSHIP_OVERLAP");
  });

  it("allows a new term that starts after the current one ends", async () => {
    const { member, plan } = await sellFresh(1000, 30);

    const stacked = await sell(owner, { memberId: member.id, planId: plan.id, startDate: day(30) });
    expect(stacked.isUpcoming).toBe(true);
    expect(stacked.startDate).toBe(day(30));
  });
});

describe("memberships — lazy expiry (1.8, no scheduler)", () => {
  it("reports a lapsed term as EXPIRED on read and persists the flip", async () => {
    const member = await createMember();
    const plan = await createPlan(500, 10);
    // Backdated so the term is already over — no clock mocking, no cron, just a real past term.
    const membership = await sell(owner, { memberId: member.id, planId: plan.id, startDate: day(-40) });
    expect(membership.status).toBe("ACTIVE");

    const stored = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(stored.status).toBe("ACTIVE");

    const res = await request(app)
      .get(url(owner, `/${membership.id}`))
      .set(...bearer(owner));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("EXPIRED");
    expect(res.body.data.daysRemaining).toBe(0);

    const flipped = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(flipped.status).toBe("EXPIRED");
  });

  it("keeps the status filter honest — a lapsed term is not in ?status=ACTIVE", async () => {
    const member = await createMember();
    const plan = await createPlan(500, 10);
    const lapsed = await sell(owner, { memberId: member.id, planId: plan.id, startDate: day(-40) });

    const active = await request(app)
      .get(url(owner))
      .query({ memberId: member.id, status: "ACTIVE" })
      .set(...bearer(owner));
    expect(active.body.data.map((m: MembershipBody) => m.id)).not.toContain(lapsed.id);

    const expired = await request(app)
      .get(url(owner))
      .query({ memberId: member.id, status: "EXPIRED" })
      .set(...bearer(owner));
    expect(expired.body.data.map((m: MembershipBody) => m.id)).toContain(lapsed.id);
  });

  it("does not expire a frozen term whose end date has passed — its clock is paused", async () => {
    const { membership } = await sellFresh(500, 10);
    await request(app)
      .post(url(owner, `/${membership.id}/freeze`))
      .set(...bearer(owner))
      .expect(200);

    // Push the end date into the past while frozen: an unfrozen row here would lapse.
    await prisma.membership.update({
      where: { id: membership.id },
      data: { endDate: addDays(TODAY, -5) },
    });

    const res = await request(app)
      .get(url(owner, `/${membership.id}`))
      .set(...bearer(owner));

    expect(res.body.data.status).toBe("FROZEN");
  });
});

describe("memberships — freeze and unfreeze (1.15.2, the clock pauses)", () => {
  it("freezes an ACTIVE term and records when the freeze began", async () => {
    const { membership } = await sellFresh();

    const res = await request(app)
      .post(url(owner, `/${membership.id}/freeze`))
      .set(...bearer(owner));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("FROZEN");
    expect(res.body.data.frozenAt).not.toBeNull();
  });

  it("pushes endDate forward by the frozen duration on unfreeze", async () => {
    // A term that began 10 days ago, so a freeze 7 days ago is a scenario that could really
    // have happened rather than a freeze predating the membership.
    const { membership } = await sellFresh(1000, 30, -10);
    expect(membership.endDate).toBe(day(19));

    await request(app)
      .post(url(owner, `/${membership.id}/freeze`))
      .set(...bearer(owner))
      .expect(200);

    // Backdate the freeze by 7 days — the same shape as a real week-long freeze, without waiting.
    await prisma.membership.update({
      where: { id: membership.id },
      data: { frozenAt: addDays(new Date(), -7) },
    });

    const res = await request(app)
      .post(url(owner, `/${membership.id}/unfreeze`))
      .set(...bearer(owner));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: "ACTIVE",
      frozenAt: null,
      totalFrozenDays: 7,
      // Was day(19); the seven paused days are handed back at the end.
      endDate: day(26),
    });
  });

  it("charges nothing for a freeze and unfreeze on the same day", async () => {
    const { membership } = await sellFresh(1000, 30);
    await request(app)
      .post(url(owner, `/${membership.id}/freeze`))
      .set(...bearer(owner))
      .expect(200);

    const res = await request(app)
      .post(url(owner, `/${membership.id}/unfreeze`))
      .set(...bearer(owner));

    expect(res.body.data).toMatchObject({ totalFrozenDays: 0, endDate: day(29) });
  });

  it("reports a paused countdown while frozen instead of draining it", async () => {
    // 30-day term that started 10 days ago, frozen 3 days ago: 7 days were used before the
    // pause, so 23 remain and stay at 23 for as long as the freeze lasts.
    const { membership } = await sellFresh(1000, 30, -10);
    await request(app)
      .post(url(owner, `/${membership.id}/freeze`))
      .set(...bearer(owner))
      .expect(200);
    await prisma.membership.update({
      where: { id: membership.id },
      data: { frozenAt: addDays(new Date(), -3) },
    });

    const res = await request(app)
      .get(url(owner, `/${membership.id}`))
      .set(...bearer(owner));

    // A naive countdown to endDate would already have burned those three days and said 20.
    expect(res.body.data.daysRemaining).toBe(23);
  });

  it("accumulates totalFrozenDays across repeated freezes", async () => {
    const { membership } = await sellFresh(1000, 30, -10);

    for (const backdate of [3, 2]) {
      await request(app)
        .post(url(owner, `/${membership.id}/freeze`))
        .set(...bearer(owner))
        .expect(200);
      await prisma.membership.update({
        where: { id: membership.id },
        data: { frozenAt: addDays(new Date(), -backdate) },
      });
      await request(app)
        .post(url(owner, `/${membership.id}/unfreeze`))
        .set(...bearer(owner))
        .expect(200);
    }

    const row = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(row.totalFrozenDays).toBe(5);
    expect(formatCalendarDate(row.endDate)).toBe(day(24));
    // The original commercial term is still reconstructible from the row alone.
    expect(formatCalendarDate(addDays(row.endDate, -row.totalFrozenDays))).toBe(day(19));
  });
});

describe("memberships — the transition matrix (1.15.1)", () => {
  it("rejects every move that isn't on the matrix, naming both states", async () => {
    const cases: { setup: () => Promise<string>; action: string; from: string }[] = [
      {
        from: "FROZEN",
        action: "freeze",
        setup: async () => {
          const { membership } = await sellFresh();
          await request(app).post(url(owner, `/${membership.id}/freeze`)).set(...bearer(owner)).expect(200);
          return membership.id;
        },
      },
      {
        from: "ACTIVE",
        action: "unfreeze",
        setup: async () => (await sellFresh()).membership.id,
      },
      {
        from: "CANCELLED",
        action: "freeze",
        setup: async () => {
          const { membership } = await sellFresh();
          await request(app).post(url(owner, `/${membership.id}/cancel`)).set(...bearer(owner)).expect(200);
          return membership.id;
        },
      },
      {
        from: "CANCELLED",
        action: "cancel",
        setup: async () => {
          const { membership } = await sellFresh();
          await request(app).post(url(owner, `/${membership.id}/cancel`)).set(...bearer(owner)).expect(200);
          return membership.id;
        },
      },
      {
        from: "EXPIRED",
        action: "freeze",
        setup: async () => {
          const member = await createMember();
          const plan = await createPlan(500, 10);
          const m = await sell(owner, { memberId: member.id, planId: plan.id, startDate: day(-40) });
          return m.id;
        },
      },
      {
        from: "EXPIRED",
        action: "cancel",
        setup: async () => {
          const member = await createMember();
          const plan = await createPlan(500, 10);
          const m = await sell(owner, { memberId: member.id, planId: plan.id, startDate: day(-40) });
          return m.id;
        },
      },
    ];

    for (const testCase of cases) {
      const membershipId = await testCase.setup();
      const res = await request(app)
        .post(url(owner, `/${membershipId}/${testCase.action}`))
        .set(...bearer(owner));

      expect(
        { action: testCase.action, from: testCase.from, status: res.status, code: res.body.error?.code },
      ).toEqual({
        action: testCase.action,
        from: testCase.from,
        status: 409,
        code: "INVALID_MEMBERSHIP_TRANSITION",
      });
      expect(res.body.error.message).toContain(testCase.from);
    }
  });

  it("cancels an ACTIVE term and a FROZEN one, and leaves both terminal", async () => {
    const fromActive = await sellFresh();
    const cancelled = await request(app)
      .post(url(owner, `/${fromActive.membership.id}/cancel`))
      .set(...bearer(owner));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe("CANCELLED");

    const fromFrozen = await sellFresh();
    await request(app).post(url(owner, `/${fromFrozen.membership.id}/freeze`)).set(...bearer(owner)).expect(200);
    const cancelledFrozen = await request(app)
      .post(url(owner, `/${fromFrozen.membership.id}/cancel`))
      .set(...bearer(owner));
    expect(cancelledFrozen.status).toBe(200);
    expect(cancelledFrozen.body.data).toMatchObject({ status: "CANCELLED", frozenAt: null });
  });
});

describe("memberships — renewal (1.15.3, a new row per term)", () => {
  it("creates a new row starting the day after the current term, leaving the old one alone", async () => {
    const { membership, plan } = await sellFresh(1000, 30);

    const res = await request(app)
      .post(url(owner, `/${membership.id}/renew`))
      .set(...bearer(owner))
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      id: expect.not.stringMatching(membership.id),
      planId: plan.id,
      status: "ACTIVE",
      startDate: day(30),
      endDate: day(59),
      previousMembershipId: membership.id,
      isUpcoming: true,
    });

    const source = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(source.status).toBe("ACTIVE");
    expect(formatCalendarDate(source.endDate)).toBe(day(29));
  });

  it("prices the new term at the plan's current price, not the old snapshot", async () => {
    const { membership, plan } = await sellFresh(1000, 30);
    await prisma.membershipPlan.update({ where: { id: plan.id }, data: { price: 1800 } });

    const res = await request(app)
      .post(url(owner, `/${membership.id}/renew`))
      .set(...bearer(owner))
      .send({});

    expect(res.body.data.priceAtPurchase).toBe("1800.00");
    const source = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(source.priceAtPurchase.toFixed(2)).toBe("1000.00");
  });

  it("starts today when renewing a term that already lapsed", async () => {
    const member = await createMember();
    const plan = await createPlan(500, 10);
    const lapsed = await sell(owner, { memberId: member.id, planId: plan.id, startDate: day(-40) });

    const res = await request(app)
      .post(url(owner, `/${lapsed.id}/renew`))
      .set(...bearer(owner))
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.data.startDate).toBe(day(0));
    expect(res.body.data.isUpcoming).toBe(false);
  });

  it("can renew onto a different plan, which is the no-forfeit way to change plan", async () => {
    const { membership } = await sellFresh(1000, 30);
    const premium = await createPlan(3000, 90);

    const res = await request(app)
      .post(url(owner, `/${membership.id}/renew`))
      .set(...bearer(owner))
      .send({ planId: premium.id });

    expect(res.body.data).toMatchObject({
      planId: premium.id,
      priceAtPurchase: "3000.00",
      durationDaysAtPurchase: 90,
      startDate: day(30),
      endDate: day(119),
    });
  });

  it("refuses to renew a CANCELLED membership", async () => {
    const { membership } = await sellFresh();
    await request(app).post(url(owner, `/${membership.id}/cancel`)).set(...bearer(owner)).expect(200);

    const res = await request(app)
      .post(url(owner, `/${membership.id}/renew`))
      .set(...bearer(owner))
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_MEMBERSHIP_TRANSITION");
    expect(res.body.error.message).toMatch(/CANCELLED/);
  });

  it("asks for a FROZEN membership to be unfrozen before renewing", async () => {
    const { membership } = await sellFresh();
    await request(app).post(url(owner, `/${membership.id}/freeze`)).set(...bearer(owner)).expect(200);

    const res = await request(app)
      .post(url(owner, `/${membership.id}/renew`))
      .set(...bearer(owner))
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/unfreeze/i);
  });
});

describe("memberships — mid-term plan change (1.15.4, fresh start, proration deferred)", () => {
  it("cancels the old term, starts the new plan today, and reports the forfeited days", async () => {
    const { membership } = await sellFresh(1000, 30);
    const premium = await createPlan(3000, 90);

    const res = await request(app)
      .post(url(owner, `/${membership.id}/change-plan`))
      .set(...bearer(owner))
      .send({ planId: premium.id });

    expect(res.status).toBe(201);
    expect(res.body.meta.forfeitedDays).toBe(30);
    expect(res.body.message).toMatch(/30 unused days forfeited/);
    expect(res.body.data).toMatchObject({
      planId: premium.id,
      priceAtPurchase: "3000.00",
      startDate: day(0),
      endDate: day(89),
      previousMembershipId: membership.id,
    });

    const source = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(source.status).toBe("CANCELLED");
  });

  it("rejects a switch to the plan the membership is already on", async () => {
    const { membership, plan } = await sellFresh();

    const res = await request(app)
      .post(url(owner, `/${membership.id}/change-plan`))
      .set(...bearer(owner))
      .send({ planId: plan.id });

    expect(res.status).toBe(400);
  });

  it("asks for a FROZEN membership to be unfrozen first, and refuses terminal ones", async () => {
    const frozen = await sellFresh();
    const target = await createPlan(2000, 60);
    await request(app).post(url(owner, `/${frozen.membership.id}/freeze`)).set(...bearer(owner)).expect(200);

    const frozenRes = await request(app)
      .post(url(owner, `/${frozen.membership.id}/change-plan`))
      .set(...bearer(owner))
      .send({ planId: target.id });
    expect(frozenRes.status).toBe(409);
    expect(frozenRes.body.error.message).toMatch(/unfreeze/i);

    const cancelled = await sellFresh();
    await request(app).post(url(owner, `/${cancelled.membership.id}/cancel`)).set(...bearer(owner)).expect(200);
    const cancelledRes = await request(app)
      .post(url(owner, `/${cancelled.membership.id}/change-plan`))
      .set(...bearer(owner))
      .send({ planId: target.id });
    expect(cancelledRes.status).toBe(409);
    expect(cancelledRes.body.error.code).toBe("INVALID_MEMBERSHIP_TRANSITION");
  });
});

describe("memberships — list (Section 1.9)", () => {
  it("combines search, status filter, sort and pagination", async () => {
    const plan = await createPlan(1000, 30);
    const marker = generateId().slice(-6);
    const members = await Promise.all(
      ["Anaya", "Bharat", "Chetan"].map(async (firstName, index) => {
        const member = await prisma.member.create({
          data: {
            id: generateId(),
            organizationId: tenant.organization.id,
            branchId: tenant.branch.id,
            firstName,
            lastName: `List${marker}`,
            phone: `+9197${generateId().slice(-9)}`,
          },
        });
        await sell(owner, { memberId: member.id, planId: plan.id, startDate: day(index) });
        return member;
      }),
    );
    // One cancelled term that the ACTIVE filter must drop.
    const dropped = await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: tenant.organization.id,
        branchId: tenant.branch.id,
        firstName: "Deepa",
        lastName: `List${marker}`,
        phone: `+9197${generateId().slice(-9)}`,
      },
    });
    const droppedMembership = await sell(owner, { memberId: dropped.id, planId: plan.id });
    await request(app).post(url(owner, `/${droppedMembership.id}/cancel`)).set(...bearer(owner)).expect(200);

    const page1 = await request(app)
      .get(url(owner))
      .query({
        search: `List${marker}`,
        status: "ACTIVE",
        sortBy: "startDate",
        sortOrder: "desc",
        page: 1,
        limit: 2,
      })
      .set(...bearer(owner));

    expect(page1.status).toBe(200);
    expect(page1.body.pagination).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(page1.body.data.map((m: MembershipBody) => m.memberId)).toEqual([
      members[2]!.id,
      members[1]!.id,
    ]);

    const page2 = await request(app)
      .get(url(owner))
      .query({
        search: `List${marker}`,
        status: "ACTIVE",
        sortBy: "startDate",
        sortOrder: "desc",
        page: 2,
        limit: 2,
      })
      .set(...bearer(owner));
    expect(page2.body.data.map((m: MembershipBody) => m.memberId)).toEqual([members[0]!.id]);
  });

  it("embeds the member and plan so a list table needs no follow-up requests", async () => {
    const { member, membership } = await sellFresh();

    const res = await request(app)
      .get(url(owner, `/${membership.id}`))
      .set(...bearer(owner));

    expect(res.body.data.member).toMatchObject({ id: member.id, firstName: member.firstName });
    expect(res.body.data.plan).toMatchObject({ id: membership.planId });
  });

  it("rejects a sort field that isn't on the allow-list", async () => {
    const res = await request(app)
      .get(url(owner))
      .query({ sortBy: "priceAtPurchase" })
      .set(...bearer(owner));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("memberships — RBAC (Section 4.2)", () => {
  it("lets a RECEPTIONIST sell and renew, but not freeze, cancel or change plan", async () => {
    const member = await createMember();
    const plan = await createPlan(1000, 30);
    const premium = await createPlan(3000, 90);

    const created = await request(app)
      .post(url(receptionist))
      .set(...bearer(receptionist))
      .send({ memberId: member.id, planId: plan.id });
    expect(created.status).toBe(201);
    const membershipId = created.body.data.id as string;

    const viewed = await request(app)
      .get(url(receptionist, `/${membershipId}`))
      .set(...bearer(receptionist));
    expect(viewed.status).toBe(200);

    const renewed = await request(app)
      .post(url(receptionist, `/${membershipId}/renew`))
      .set(...bearer(receptionist))
      .send({});
    expect(renewed.status).toBe(201);

    for (const action of ["freeze", "cancel"]) {
      const res = await request(app)
        .post(url(receptionist, `/${membershipId}/${action}`))
        .set(...bearer(receptionist));
      expect({ action, status: res.status, code: res.body.error?.code }).toEqual({
        action,
        status: 403,
        code: "PERMISSION_DENIED",
      });
    }

    // change-plan needs cancel *and* create; holding only create is not enough.
    const changed = await request(app)
      .post(url(receptionist, `/${membershipId}/change-plan`))
      .set(...bearer(receptionist))
      .send({ planId: premium.id });
    expect(changed.status).toBe(403);
    expect(changed.body.error.message).toMatch(/memberships\.cancel/);
  });

  it("lets a MANAGER run the whole lifecycle", async () => {
    const { membership } = await sellFresh();

    await request(app).post(url(manager, `/${membership.id}/freeze`)).set(...bearer(manager)).expect(200);
    await request(app).post(url(manager, `/${membership.id}/unfreeze`)).set(...bearer(manager)).expect(200);
    await request(app).post(url(manager, `/${membership.id}/cancel`)).set(...bearer(manager)).expect(200);
  });

  it("denies a TRAINER, who holds no memberships permission", async () => {
    const res = await request(app).get(url(trainer)).set(...bearer(trainer));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PERMISSION_DENIED");
  });
});

describe("memberships — tenant and branch scoping", () => {
  it("denies another organization's owner on every verb", async () => {
    const { membership } = await sellFresh();
    const stranger = await createActor(await createTestTenant("Other Memberships"), "OWNER");

    for (const call of [
      request(app).get(url(owner, `/${membership.id}`)),
      request(app).post(url(owner, `/${membership.id}/freeze`)),
      request(app).post(url(owner, `/${membership.id}/cancel`)),
      request(app).post(url(owner, `/${membership.id}/renew`)).send({}),
    ]) {
      const res = await call.set(...bearer(stranger));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("ORG_MISMATCH");
    }
  });

  it("hides another branch's membership from a branch-scoped user", async () => {
    const otherBranch = await prisma.branch.create({
      data: { id: generateId(), organizationId: tenant.organization.id, name: `B ${generateId().slice(-5)}` },
    });
    const member = await createMember({ branchId: otherBranch.id });
    const plan = await createPlan();
    const membership = await sell(owner, { memberId: member.id, planId: plan.id });

    // The receptionist is pinned to tenant.branch, and names no branch of their own here.
    const res = await request(app)
      .get(url(receptionist, `/${membership.id}`))
      .set(...bearer(receptionist));
    expect(res.status).toBe(404);

    const list = await request(app).get(url(receptionist)).query({ limit: 100 }).set(...bearer(receptionist));
    expect(list.body.data.map((m: MembershipBody) => m.id)).not.toContain(membership.id);
  });
});
