import { Prisma } from "@prisma/client";
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
import {
  addDays,
  formatCalendarDate,
  formatLocalMonth,
  localCalendarDate,
  localMonthBounds,
  localMonthOf,
  todayUtc,
} from "../../utils/dates";

const GYM_TZ = "Asia/Kolkata";

let tenant: TestTenant;
let otherBranch: { id: string; name: string };
let owner: TestActor;
let receptionist: TestActor;
let trainer: TestActor;
let accountant: TestActor;
let plan: { id: string };

function url(actor: TestActor, query = "") {
  return `/api/v1/organizations/${actor.organization.id}/reports/dashboard${query}`;
}

async function dashboard(actor: TestActor, query: Record<string, string> = {}) {
  const params = new URLSearchParams(query).toString();
  return request(app)
    .get(url(actor, params ? `?${params}` : ""))
    .set(...bearer(actor));
}

async function createMember(
  overrides: { branchId?: string; status?: "ACTIVE" | "INACTIVE" | "ARCHIVED"; firstName?: string } = {},
) {
  const suffix = generateId().slice(-8);
  return prisma.member.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      branchId: overrides.branchId ?? tenant.branch.id,
      firstName: overrides.firstName ?? "Dash",
      lastName: suffix,
      phone: `+9194${suffix}`,
      status: overrides.status ?? "ACTIVE",
    },
  });
}

async function createTerm(
  memberId: string,
  options: {
    branchId?: string;
    status?: "ACTIVE" | "EXPIRED" | "FROZEN" | "CANCELLED";
    start?: Date;
    end?: Date;
  } = {},
) {
  const today = todayUtc();
  return prisma.membership.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      branchId: options.branchId ?? tenant.branch.id,
      memberId,
      planId: plan.id,
      priceAtPurchase: new Prisma.Decimal("1000.00"),
      durationDaysAtPurchase: 30,
      startDate: options.start ?? addDays(today, -10),
      endDate: options.end ?? addDays(today, 19),
      status: options.status ?? "ACTIVE",
      frozenAt: options.status === "FROZEN" ? new Date() : null,
    },
  });
}

async function createInvoice(
  member: { id: string; branchId: string },
  options: {
    total: string;
    pending?: string;
    paid?: string;
    status?: "UNPAID" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";
    branchId?: string;
    membershipId?: string | null;
  },
) {
  const total = new Prisma.Decimal(options.total);
  const paid = new Prisma.Decimal(options.paid ?? "0.00");
  const pending =
    options.status === "CANCELLED"
      ? new Prisma.Decimal(0)
      : new Prisma.Decimal(options.pending ?? total.minus(paid).toFixed(2));

  return prisma.invoice.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      branchId: options.branchId ?? member.branchId,
      memberId: member.id,
      membershipId: options.membershipId ?? null,
      invoiceNumber: `INV-TEST-${generateId().slice(-10)}`,
      amountTotal: total,
      amountPaid: paid,
      amountPending: pending,
      status: options.status ?? (paid.greaterThan(0) ? "PARTIALLY_PAID" : "UNPAID"),
    },
  });
}

async function createPayment(
  invoice: { id: string; memberId: string; membershipId: string | null; branchId: string },
  options: {
    amount: string;
    paidAt?: Date;
    status?: "SUCCESS" | "FAILED" | "PENDING" | "REFUNDED";
    branchId?: string;
    refundOfPaymentId?: string;
  },
) {
  return prisma.payment.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      branchId: options.branchId ?? invoice.branchId,
      memberId: invoice.memberId,
      membershipId: invoice.membershipId,
      invoiceId: invoice.id,
      amount: new Prisma.Decimal(options.amount),
      method: "CASH",
      status: options.status ?? "SUCCESS",
      paidAt: options.paidAt ?? new Date(),
      refundOfPaymentId: options.refundOfPaymentId ?? null,
    },
  });
}

async function checkIn(
  memberId: string,
  options: { branchId?: string; date?: Date } = {},
) {
  const date = options.date ?? localCalendarDate(new Date(), GYM_TZ);
  return prisma.attendance.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      branchId: options.branchId ?? tenant.branch.id,
      memberId,
      attendanceDate: date,
      overrideReason: "NO_MEMBERSHIP",
    },
  });
}

beforeAll(async () => {
  tenant = await createTestTenant("Reports");
  otherBranch = await prisma.branch.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      name: `Other ${generateId().slice(-4)}`,
    },
  });
  owner = await createActor(tenant, "OWNER");
  receptionist = await createActor(tenant, "RECEPTIONIST", { branchScoped: true });
  trainer = await createActor(tenant, "TRAINER", { branchScoped: true });
  accountant = await createActor(tenant, "ACCOUNTANT");
  plan = await prisma.membershipPlan.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      name: `Dash Plan ${generateId().slice(-4)}`,
      price: new Prisma.Decimal("1000.00"),
      durationDays: 30,
    },
  });
});

describe("GET /reports/dashboard — members (1.18.3)", () => {
  it("counts people on the books, not MemberStatus.ACTIVE, and covering terms distinctly", async () => {
    const before = await dashboard(owner, { branchId: tenant.branch.id });
    expect(before.status).toBe(200);

    const covering = await createMember({ firstName: "Covering" });
    await createTerm(covering.id);

    const onBooksNoTerm = await createMember({ firstName: "OnBooks" });

    const inactive = await createMember({ firstName: "Inactive", status: "INACTIVE" });

    const archived = await createMember({ firstName: "Archived", status: "ARCHIVED" });
    await createTerm(archived.id);

    const elsewhere = await createMember({ firstName: "Elsewhere", branchId: otherBranch.id });
    await createTerm(elsewhere.id, { branchId: otherBranch.id });

    const scoped = await dashboard(owner, { branchId: tenant.branch.id });
    expect(scoped.status).toBe(200);

    // Covering, on-books-without-a-term, and INACTIVE are on the books here. Archived is not.
    // The other-branch member is not this branch's. Only `covering` has a term over today.
    expect(scoped.body.data.widgets.members.total).toBe(before.body.data.widgets.members.total + 3);
    expect(scoped.body.data.widgets.members.active).toBe(before.body.data.widgets.members.active + 1);
    expect(onBooksNoTerm.status).toBe("ACTIVE");
    expect(inactive.status).toBe("INACTIVE");
    expect(archived.status).toBe("ARCHIVED");
    expect(elsewhere.branchId).toBe(otherBranch.id);
  });
});

describe("GET /reports/dashboard — revenue (1.18.1, 1.18.2)", () => {
  it("sums collected cash by paidAt in the gym's month, nets refunds, and ignores failed/pending", async () => {
    const member = await createMember({ firstName: "Payer" });
    const invoice = await createInvoice(member, { total: "5000.00", paid: "5000.00", pending: "0.00", status: "PAID" });

    const thisMonth = localMonthOf(new Date(), GYM_TZ);
    const { start } = localMonthBounds(thisMonth, GYM_TZ);
    // 02:00 local on the 1st — UTC would file this under the previous month (1.18.1).
    const earlyMorning = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const lastMonthEnd = new Date(start.getTime() - 60 * 1000);

    await createPayment(invoice, { amount: "1000.00", paidAt: earlyMorning });
    await createPayment(invoice, { amount: "400.00", paidAt: lastMonthEnd });
    const original = await createPayment(invoice, { amount: "250.00", paidAt: new Date() });
    await createPayment(invoice, {
      amount: "-100.00",
      paidAt: new Date(),
      status: "REFUNDED",
      refundOfPaymentId: original.id,
    });
    await createPayment(invoice, { amount: "999.00", paidAt: new Date(), status: "FAILED" });
    await createPayment(invoice, { amount: "888.00", paidAt: new Date(), status: "PENDING" });

    const res = await dashboard(owner, { branchId: tenant.branch.id });
    expect(res.status).toBe(200);

    const { start: monthStart, end: monthEnd } = localMonthBounds(thisMonth, GYM_TZ);
    const expected = await prisma.payment.aggregate({
      where: {
        organizationId: tenant.organization.id,
        branchId: tenant.branch.id,
        paidAt: { gte: monthStart, lt: monthEnd },
        status: { notIn: ["FAILED", "PENDING"] },
      },
      _sum: { amount: true },
    });

    expect(res.body.data.widgets.revenue.total).toBe((expected._sum.amount ?? new Prisma.Decimal(0)).toFixed(2));
    expect(res.body.data.widgets.revenue.month).toBe(formatLocalMonth(thisMonth));
    expect(res.body.data.timezone).toBe(GYM_TZ);
    expect(res.body.data.widgets.revenue.trend).toHaveLength(6);
    expect(res.body.data.widgets.revenue.trend.at(-1).month).toBe(formatLocalMonth(thisMonth));
    expect(res.body.data.widgets.revenue.trend.at(-1).total).toBe(res.body.data.widgets.revenue.total);
  });

  it("attributes revenue to the stamped branch, not wherever the member lives now (1.18.2)", async () => {
    const member = await createMember({ firstName: "Mover", branchId: tenant.branch.id });
    const invoice = await createInvoice(member, {
      total: "700.00",
      paid: "700.00",
      pending: "0.00",
      status: "PAID",
      branchId: tenant.branch.id,
    });
    await createPayment(invoice, { amount: "700.00", paidAt: new Date(), branchId: tenant.branch.id });

    await prisma.member.update({ where: { id: member.id }, data: { branchId: otherBranch.id } });

    const home = await dashboard(owner, { branchId: tenant.branch.id });
    const away = await dashboard(owner, { branchId: otherBranch.id });

    const homeRevenue = Number(home.body.data.widgets.revenue.total);
    const awayRevenue = Number(away.body.data.widgets.revenue.total);

    // The 700 still sits in the branch that took it. The destination branch did not inherit it.
    expect(homeRevenue - awayRevenue).toBeGreaterThanOrEqual(700);
    expect(away.body.data.widgets.members.total).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /reports/dashboard — outstanding (1.18.5)", () => {
  it("reads the cached rollup and ignores a cancelled invoice", async () => {
    const member = await createMember({ firstName: "Owes" });
    await createInvoice(member, { total: "300.00", pending: "300.00", status: "UNPAID" });
    await createInvoice(member, {
      total: "900.00",
      pending: "0.00",
      paid: "0.00",
      status: "CANCELLED",
    });

    const res = await dashboard(owner, { branchId: tenant.branch.id });
    expect(res.status).toBe(200);

    const expected = await prisma.invoice.aggregate({
      where: {
        organizationId: tenant.organization.id,
        amountPending: { gt: 0 },
        member: {
          branchId: tenant.branch.id,
          deletedAt: null,
          status: { not: "ARCHIVED" },
        },
      },
      _sum: { amountPending: true },
    });
    const expectedCount = await prisma.invoice.count({
      where: {
        organizationId: tenant.organization.id,
        amountPending: { gt: 0 },
        member: {
          branchId: tenant.branch.id,
          deletedAt: null,
          status: { not: "ARCHIVED" },
        },
      },
    });

    expect(res.body.data.widgets.outstanding.amount).toBe(
      (expected._sum.amountPending ?? new Prisma.Decimal(0)).toFixed(2),
    );
    expect(res.body.data.widgets.outstanding.invoiceCount).toBe(expectedCount);
  });

  it("moves outstanding with the member on transfer, unlike revenue", async () => {
    const member = await createMember({ firstName: "Chaseable", branchId: tenant.branch.id });
    await createInvoice(member, {
      total: "150.00",
      pending: "150.00",
      status: "UNPAID",
      branchId: tenant.branch.id,
    });

    const beforeHome = await dashboard(owner, { branchId: tenant.branch.id });
    const beforeAway = await dashboard(owner, { branchId: otherBranch.id });

    await prisma.member.update({ where: { id: member.id }, data: { branchId: otherBranch.id } });

    const afterHome = await dashboard(owner, { branchId: tenant.branch.id });
    const afterAway = await dashboard(owner, { branchId: otherBranch.id });

    expect(Number(afterHome.body.data.widgets.outstanding.amount)).toBe(
      Number(beforeHome.body.data.widgets.outstanding.amount) - 150,
    );
    expect(Number(afterAway.body.data.widgets.outstanding.amount)).toBe(
      Number(beforeAway.body.data.widgets.outstanding.amount) + 150,
    );
  });
});

describe("GET /reports/dashboard — expiring (1.18.4)", () => {
  it("is a 7-day worklist: frozen, cancelled, and far-off terms stay out", async () => {
    const today = todayUtc();
    const soon = await createMember({ firstName: "Soon" });
    await createTerm(soon.id, { end: addDays(today, 3) });

    const later = await createMember({ firstName: "Later" });
    await createTerm(later.id, { end: addDays(today, 20) });

    const frozen = await createMember({ firstName: "FrozenSoon" });
    await createTerm(frozen.id, { status: "FROZEN", end: addDays(today, 2) });

    const res = await dashboard(owner, { branchId: tenant.branch.id });
    expect(res.status).toBe(200);

    const ids = res.body.data.widgets.expiring.items.map((row: { memberId: string }) => row.memberId);
    expect(ids).toContain(soon.id);
    expect(ids).not.toContain(later.id);
    expect(ids).not.toContain(frozen.id);
    expect(res.body.data.widgets.expiring.withinDays).toBe(7);

    const longer = await dashboard(owner, { branchId: tenant.branch.id, expiringWithinDays: "30" });
    const longerIds = longer.body.data.widgets.expiring.items.map(
      (row: { memberId: string }) => row.memberId,
    );
    expect(longerIds).toContain(soon.id);
    expect(longerIds).toContain(later.id);
    expect(longer.body.data.widgets.expiring.withinDays).toBe(30);
  });

  it("rejects a window over 90 days rather than becoming 'everyone'", async () => {
    const res = await dashboard(owner, { expiringWithinDays: "91" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /reports/dashboard — attendance", () => {
  it("counts today's visits at the branch they happened, in the gym's timezone", async () => {
    const member = await createMember({ firstName: "Visitor" });
    await checkIn(member.id, { branchId: tenant.branch.id });
    await checkIn(member.id, {
      branchId: otherBranch.id,
      date: addDays(localCalendarDate(new Date(), GYM_TZ), -1),
    });

    const res = await dashboard(owner, { branchId: tenant.branch.id });
    expect(res.status).toBe(200);
    expect(res.body.data.widgets.attendance.date).toBe(
      formatCalendarDate(localCalendarDate(new Date(), GYM_TZ)),
    );

    const expected = await prisma.attendance.count({
      where: {
        organizationId: tenant.organization.id,
        branchId: tenant.branch.id,
        attendanceDate: localCalendarDate(new Date(), GYM_TZ),
      },
    });
    expect(res.body.data.widgets.attendance.count).toBe(expected);
  });
});

describe("GET /reports/dashboard — branch scoping and tenancy", () => {
  it("pins a branch-scoped caller to their own branch and refuses a smuggled one", async () => {
    const own = await dashboard(receptionist);
    expect(own.status).toBe(200);
    expect(own.body.data.scope.branchId).toBe(tenant.branch.id);

    const smuggled = await dashboard(receptionist, { branchId: otherBranch.id });
    expect(smuggled.status).toBe(403);
    expect(smuggled.body.error.code).toBe("BRANCH_MISMATCH");
  });

  it("lets an org-wide caller sum both branches or pick one", async () => {
    const all = await dashboard(owner);
    const home = await dashboard(owner, { branchId: tenant.branch.id });
    const away = await dashboard(owner, { branchId: otherBranch.id });

    expect(all.status).toBe(200);
    expect(all.body.data.scope.branchId).toBeNull();
    expect(all.body.data.widgets.members.total).toBe(
      home.body.data.widgets.members.total + away.body.data.widgets.members.total,
    );
  });

  it("does not leak another organization's numbers", async () => {
    const stranger = await createTestTenant("DashStranger");
    const strangerOwner = await createActor(stranger, "OWNER");
    const strangerMember = await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: stranger.organization.id,
        branchId: stranger.branch.id,
        firstName: "Secret",
        lastName: "Total",
        phone: `+9193${generateId().slice(-8)}`,
      },
    });
    await prisma.invoice.create({
      data: {
        id: generateId(),
        organizationId: stranger.organization.id,
        branchId: stranger.branch.id,
        memberId: strangerMember.id,
        invoiceNumber: `INV-STR-${generateId().slice(-8)}`,
        amountTotal: new Prisma.Decimal("99999.00"),
        amountPaid: new Prisma.Decimal(0),
        amountPending: new Prisma.Decimal("99999.00"),
        status: "UNPAID",
      },
    });

    const ours = await dashboard(owner);
    const theirs = await dashboard(strangerOwner);

    expect(Number(ours.body.data.widgets.outstanding.amount)).toBeLessThan(99999);
    expect(theirs.body.data.widgets.outstanding.amount).toBe("99999.00");
  });

  it("rejects org A's token against org B's dashboard", async () => {
    const stranger = await createTestTenant("DashCross");
    const res = await request(app)
      .get(`/api/v1/organizations/${stranger.organization.id}/reports/dashboard`)
      .set(...bearer(owner));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORG_MISMATCH");
  });
});

describe("GET /reports/dashboard — RBAC (1.18.6)", () => {
  it("omits widgets the caller cannot see rather than hiding them client-side", async () => {
    const reception = await dashboard(receptionist);
    expect(reception.status).toBe(200);
    expect(reception.body.data.widgets.members).toBeDefined();
    expect(reception.body.data.widgets.outstanding).toBeDefined();
    expect(reception.body.data.widgets.expiring).toBeDefined();
    expect(reception.body.data.widgets.attendance).toBeDefined();
    expect(reception.body.data.widgets.revenue).toBeUndefined();

    const train = await dashboard(trainer);
    expect(train.status).toBe(200);
    expect(train.body.data.widgets.members).toBeDefined();
    expect(train.body.data.widgets.attendance).toBeDefined();
    expect(train.body.data.widgets.revenue).toBeUndefined();
    expect(train.body.data.widgets.outstanding).toBeUndefined();
    expect(train.body.data.widgets.expiring).toBeUndefined();

    const books = await dashboard(accountant);
    expect(books.status).toBe(200);
    expect(books.body.data.widgets.revenue).toBeDefined();
    expect(books.body.data.widgets.outstanding).toBeDefined();
    expect(books.body.data.widgets.members).toBeDefined();
    expect(books.body.data.widgets.expiring).toBeDefined();
    expect(books.body.data.widgets.attendance).toBeUndefined();
  });
});

describe("GET /reports/dashboard — reports never write (1.18.7)", () => {
  it("does not expire a stale ACTIVE term on the way through", async () => {
    const member = await createMember({ firstName: "Stale" });
    const lapsed = await createTerm(member.id, {
      status: "ACTIVE",
      start: addDays(todayUtc(), -60),
      end: addDays(todayUtc(), -30),
    });

    const res = await dashboard(owner);
    expect(res.status).toBe(200);

    const reread = await prisma.membership.findUniqueOrThrow({ where: { id: lapsed.id } });
    expect(reread.status).toBe("ACTIVE");
    expect(reread.updatedAt.getTime()).toBe(lapsed.updatedAt.getTime());
  });
});
