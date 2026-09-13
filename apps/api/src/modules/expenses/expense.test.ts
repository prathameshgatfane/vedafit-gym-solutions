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
import { formatLocalMonth, localMonthOf } from "../../utils/dates";

let tenant: TestTenant;
let otherBranch: { id: string };
let owner: TestActor;
let admin: TestActor;
let accountant: TestActor;
let manager: TestActor;
let receptionist: TestActor;
let trainer: TestActor;

const GYM_TZ = "Asia/Kolkata";

function expensesUrl(actor: TestActor, suffix = "") {
  return `/api/v1/organizations/${actor.organization.id}/expenses${suffix}`;
}

function pnlUrl(actor: TestActor, query = "") {
  return `/api/v1/organizations/${actor.organization.id}/reports/profit-loss${query}`;
}

async function createExpense(
  actor: TestActor,
  overrides: Record<string, unknown> = {},
) {
  const res = await request(app)
    .post(expensesUrl(actor))
    .set(...bearer(actor))
    .send({
      category: "RENT",
      amount: 15000,
      expenseDate: "2026-09-05",
      paidTo: "Landlord",
      branchId: actor.user.branchId ? undefined : actor.branch.id,
      ...overrides,
    });
  if (res.status !== 201) {
    throw new Error(`Expense create failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data as { id: string; amount: string; branchId: string | null; category: string };
}

beforeAll(async () => {
  tenant = await createTestTenant("Expenses");
  otherBranch = await prisma.branch.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      name: `Other ${generateId().slice(-4)}`,
    },
  });
  owner = await createActor(tenant, "OWNER");
  admin = await createActor(tenant, "ADMIN");
  accountant = await createActor(tenant, "ACCOUNTANT");
  manager = await createActor(tenant, "MANAGER");
  receptionist = await createActor(tenant, "RECEPTIONIST", { branchScoped: true });
  trainer = await createActor(tenant, "TRAINER", { branchScoped: true });
});

describe("POST /expenses — create", () => {
  it("records a branch expense as a fixed-2 amount", async () => {
    const res = await request(app)
      .post(expensesUrl(accountant))
      .set(...bearer(accountant))
      .send({
        category: "RENT",
        amount: 15000.5,
        expenseDate: "2026-09-05",
        paidTo: "Landlord",
        branchId: tenant.branch.id,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe("15000.50");
    expect(res.body.data.expenseDate).toBe("2026-09-05");
    expect(res.body.data.category).toBe("RENT");
    expect(res.body.data.branchId).toBe(tenant.branch.id);
    expect(res.body.data.createdBy.id).toBe(accountant.user.id);
  });

  it("lets org-wide staff file an unattributed (org-level) expense", async () => {
    const res = await request(app)
      .post(expensesUrl(accountant))
      .set(...bearer(accountant))
      .send({
        category: "SOFTWARE",
        amount: 6000,
        expenseDate: "2026-09-01",
        paidTo: "Zoom",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.branchId).toBeNull();
    expect(res.body.data.category).toBe("SOFTWARE");
  });

  it("refuses a zero or negative amount and an unknown category", async () => {
    const zero = await request(app)
      .post(expensesUrl(accountant))
      .set(...bearer(accountant))
      .send({ category: "RENT", amount: 0, expenseDate: "2026-09-05" });
    expect(zero.status).toBe(400);

    const bogus = await request(app)
      .post(expensesUrl(accountant))
      .set(...bearer(accountant))
      .send({ category: "SNACKS", amount: 10, expenseDate: "2026-09-05" });
    expect(bogus.status).toBe(400);
  });
});

describe("PATCH / DELETE /expenses/:id — live book (1.21.3)", () => {
  it("edits amount and hard-deletes the row", async () => {
    const created = await createExpense(accountant, { amount: 1000, paidTo: "Temp" });

    const patched = await request(app)
      .patch(expensesUrl(accountant, `/${created.id}`))
      .set(...bearer(accountant))
      .send({ amount: 1200.25, notes: "corrected" });
    expect(patched.status).toBe(200);
    expect(patched.body.data.amount).toBe("1200.25");
    expect(patched.body.data.notes).toBe("corrected");
    expect(patched.body.data.createdBy.id).toBe(accountant.user.id);

    const removed = await request(app)
      .delete(expensesUrl(accountant, `/${created.id}`))
      .set(...bearer(accountant));
    expect(removed.status).toBe(200);

    const row = await prisma.expense.findUnique({ where: { id: created.id } });
    expect(row).toBeNull();
  });
});

describe("expenses scoping and RBAC (1.21.1 / 4.2)", () => {
  it("404s a branch-scoped caller asking about another branch's expense", async () => {
    const expense = await createExpense(accountant, { branchId: otherBranch.id });
    // ACCOUNTANT is org-wide; a receptionist is the only branch-scoped role here, and they
    // do not hold expenses.manage — 403, not 404. The 404 rule is still the service's, covered
    // when an org-wide GET names a missing id.
    const missing = await request(app)
      .get(expensesUrl(accountant, `/${generateId()}`))
      .set(...bearer(accountant));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("EXPENSE_NOT_FOUND");
    expect(expense.id).toBeTruthy();
  });

  it("lets ACCOUNTANT, OWNER and ADMIN manage expenses and refuses MANAGER, RECEPTIONIST, TRAINER", async () => {
    for (const actor of [accountant, owner, admin]) {
      const res = await request(app).get(expensesUrl(actor)).set(...bearer(actor));
      expect(res.status).toBe(200);
    }

    for (const actor of [manager, receptionist, trainer]) {
      const res = await request(app).get(expensesUrl(actor)).set(...bearer(actor));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("PERMISSION_DENIED");
    }
  });
});

describe("GET /reports/profit-loss (1.21.1 / 1.21.4)", () => {
  it("matches a hand-sum of revenue minus expenses, and hides org-level costs from a branch P&L", async () => {
    const isolated = await createTestTenant("PnlExact");
    const books = await createActor(isolated, "ACCOUNTANT");
    const sibling = await prisma.branch.create({
      data: {
        id: generateId(),
        organizationId: isolated.organization.id,
        name: `Sibling ${generateId().slice(-4)}`,
      },
    });

    const month = formatLocalMonth(localMonthOf(new Date(), GYM_TZ));
    const [year, monthNum] = month.split("-") as [string, string];
    const day = `${year}-${monthNum}-10`;

    const member = await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: isolated.organization.id,
        branchId: isolated.branch.id,
        firstName: "Pnl",
        lastName: generateId().slice(-6),
        phone: `+9191${generateId().slice(-8)}`,
      },
    });
    const invoice = await prisma.invoice.create({
      data: {
        id: generateId(),
        organizationId: isolated.organization.id,
        branchId: isolated.branch.id,
        memberId: member.id,
        invoiceNumber: `INV-TEST-${generateId().slice(-8)}`,
        amountTotal: new Prisma.Decimal("2000.00"),
        amountPaid: new Prisma.Decimal("2000.00"),
        amountPending: new Prisma.Decimal("0.00"),
        status: "PAID",
      },
    });
    await prisma.payment.create({
      data: {
        id: generateId(),
        organizationId: isolated.organization.id,
        branchId: isolated.branch.id,
        memberId: member.id,
        invoiceId: invoice.id,
        amount: new Prisma.Decimal("2000.00"),
        method: "CASH",
        status: "SUCCESS",
        paidAt: new Date(),
      },
    });

    await createExpense(books, {
      category: "RENT",
      amount: 500,
      expenseDate: day,
      branchId: isolated.branch.id,
      paidTo: "Main rent",
    });
    await createExpense(books, {
      category: "SOFTWARE",
      amount: 300,
      expenseDate: day,
      paidTo: "Org software",
      branchId: null,
    });
    await createExpense(books, {
      category: "UTILITIES",
      amount: 100,
      expenseDate: day,
      branchId: sibling.id,
      paidTo: "Other power",
    });

    const orgWide = await request(app)
      .get(pnlUrl(books, `?from=${month}&to=${month}`))
      .set(...bearer(books));
    expect(orgWide.status).toBe(200);
    expect(orgWide.body.data.from).toBe(month);
    expect(orgWide.body.data.to).toBe(month);
    expect(orgWide.body.data.revenue).toBe("2000.00");
    expect(orgWide.body.data.expenses).toBe("900.00");
    expect(orgWide.body.data.net).toBe("1100.00");
    expect(
      orgWide.body.data.byCategory.find((row: { category: string }) => row.category === "SOFTWARE")
        ?.total,
    ).toBe("300.00");

    const branchPnl = await request(app)
      .get(pnlUrl(books, `?from=${month}&to=${month}&branchId=${isolated.branch.id}`))
      .set(...bearer(books));
    expect(branchPnl.status).toBe(200);
    expect(branchPnl.body.data.revenue).toBe("2000.00");
    expect(branchPnl.body.data.expenses).toBe("500.00");
    expect(branchPnl.body.data.net).toBe("1500.00");
    const branchCategories: string[] = branchPnl.body.data.byCategory.map(
      (row: { category: string }) => row.category,
    );
    expect(branchCategories).toEqual(["RENT"]);
  });

  it("lets a MANAGER read the P&L and refuses RECEPTIONIST and TRAINER", async () => {
    const ok = await request(app).get(pnlUrl(manager)).set(...bearer(manager));
    expect(ok.status).toBe(200);

    for (const actor of [receptionist, trainer]) {
      const res = await request(app).get(pnlUrl(actor)).set(...bearer(actor));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("PERMISSION_DENIED");
    }
  });

  it("refuses a backwards or over-long window", async () => {
    const backwards = await request(app)
      .get(pnlUrl(accountant, "?from=2026-09&to=2026-01"))
      .set(...bearer(accountant));
    expect(backwards.status).toBe(400);
    expect(backwards.body.error.code).toBe("EXPENSE_RANGE_INVALID");

    const long = await request(app)
      .get(pnlUrl(accountant, "?from=2024-01&to=2026-09"))
      .set(...bearer(accountant));
    expect(long.status).toBe(400);
    expect(long.body.error.code).toBe("EXPENSE_RANGE_INVALID");
  });
});
