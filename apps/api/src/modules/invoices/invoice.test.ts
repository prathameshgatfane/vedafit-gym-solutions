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
import { invoiceService } from "./invoice.service";

let tenant: TestTenant;
let owner: TestActor;
let accountant: TestActor;
let manager: TestActor;
let receptionist: TestActor;
let trainer: TestActor;

function url(actor: TestActor, suffix = "") {
  return `/api/v1/organizations/${actor.organization.id}/invoices${suffix}`;
}

async function createMember(overrides: { branchId?: string } = {}) {
  const suffix = generateId().slice(-9);
  return prisma.member.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      branchId: overrides.branchId ?? tenant.branch.id,
      firstName: "Bill",
      lastName: `Payer ${suffix.slice(-4)}`,
      phone: `+9197${suffix}`,
    },
  });
}

interface InvoiceBody {
  id: string;
  invoiceNumber: string;
  memberId: string;
  membershipId: string | null;
  amountTotal: string;
  amountPaid: string;
  amountPending: string;
  status: string;
  notes: string | null;
}

async function raise(
  actor: TestActor,
  body: { memberId: string; amountTotal: number; notes: string },
): Promise<InvoiceBody> {
  const res = await request(app)
    .post(url(actor))
    .set(...bearer(actor))
    .send(body);

  if (res.status !== 201) {
    throw new Error(`Invoice create failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data as InvoiceBody;
}

beforeAll(async () => {
  tenant = await createTestTenant("Invoices");
  owner = await createActor(tenant, "OWNER");
  accountant = await createActor(tenant, "ACCOUNTANT");
  manager = await createActor(tenant, "MANAGER");
  receptionist = await createActor(tenant, "RECEPTIONIST", { branchScoped: true });
  trainer = await createActor(tenant, "TRAINER");
});

describe("invoices — creation and the derived rollup (1.16.2)", () => {
  it("is born UNPAID with nothing collected and everything pending", async () => {
    const member = await createMember();
    const invoice = await raise(owner, {
      memberId: member.id,
      amountTotal: 2500,
      notes: "Joining fee",
    });

    expect(invoice).toMatchObject({
      amountTotal: "2500.00",
      amountPaid: "0.00",
      amountPending: "2500.00",
      // Never DRAFT: an invoice raised here is immediately payable.
      status: "UNPAID",
      notes: "Joining fee",
      membershipId: null,
    });

    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(row.amountTotal.toFixed(2)).toBe("2500.00");
    expect(row.amountPending.toFixed(2)).toBe("2500.00");
  });

  it("stores paise exactly rather than as a float", async () => {
    const member = await createMember();
    const invoice = await raise(owner, {
      memberId: member.id,
      amountTotal: 1499.95,
      notes: "Personal training",
    });

    expect(invoice.amountTotal).toBe("1499.95");
  });

  it("lands a zero-total invoice as PAID, since there is nothing to collect", async () => {
    const member = await createMember();
    const invoice = await raise(owner, {
      memberId: member.id,
      amountTotal: 0,
      notes: "Complimentary induction",
    });

    expect(invoice).toMatchObject({
      amountTotal: "0.00",
      amountPaid: "0.00",
      amountPending: "0.00",
      status: "PAID",
    });
  });

  it("rejects a negative amount and a 3-decimal amount", async () => {
    const member = await createMember();

    const negative = await request(app)
      .post(url(owner))
      .set(...bearer(owner))
      .send({ memberId: member.id, amountTotal: -100, notes: "Nope" });
    expect(negative.status).toBe(400);
    expect(negative.body.error.code).toBe("VALIDATION_ERROR");

    const fractional = await request(app)
      .post(url(owner))
      .set(...bearer(owner))
      .send({ memberId: member.id, amountTotal: 10.001, notes: "Nope" });
    expect(fractional.status).toBe(400);
  });

  it("requires notes, so an ad-hoc bill always says what it is for", async () => {
    const member = await createMember();
    const res = await request(app)
      .post(url(owner))
      .set(...bearer(owner))
      .send({ memberId: member.id, amountTotal: 500 });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty("notes");
  });

  it("404s on a member from another organization rather than billing a stranger", async () => {
    const stranger = await createTestTenant("InvoiceStranger");
    const strangerMember = await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: stranger.organization.id,
        branchId: stranger.branch.id,
        firstName: "Other",
        lastName: "Org",
        phone: `+9196${generateId().slice(-9)}`,
      },
    });

    const res = await request(app)
      .post(url(owner))
      .set(...bearer(owner))
      .send({ memberId: strangerMember.id, amountTotal: 100, notes: "Nope" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("MEMBER_NOT_FOUND");
  });

  it("has no update route — amountTotal is immutable", async () => {
    const member = await createMember();
    const invoice = await raise(owner, { memberId: member.id, amountTotal: 100, notes: "x" });

    const patched = await request(app)
      .patch(url(owner, `/${invoice.id}`))
      .set(...bearer(owner))
      .send({ amountTotal: 5 });
    expect(patched.status).toBe(404);

    const deleted = await request(app)
      .delete(url(owner, `/${invoice.id}`))
      .set(...bearer(owner));
    expect(deleted.status).toBe(404);
  });
});

describe("invoices — numbering (1.16.4)", () => {
  it("formats as INV-YYYY-NNNNNN and increments within the organization", async () => {
    const member = await createMember();
    const year = new Date().getUTCFullYear();

    const first = await raise(owner, { memberId: member.id, amountTotal: 10, notes: "a" });
    const second = await raise(owner, { memberId: member.id, amountTotal: 10, notes: "b" });

    expect(first.invoiceNumber).toMatch(new RegExp(`^INV-${year}-\\d{6}$`));

    const firstSeq = Number(first.invoiceNumber.split("-")[2]);
    const secondSeq = Number(second.invoiceNumber.split("-")[2]);
    expect(secondSeq).toBe(firstSeq + 1);
  });

  it("keeps a separate sequence per organization, so volume doesn't leak between tenants", async () => {
    const otherTenant = await createTestTenant("InvoiceSeq");
    const otherOwner = await createActor(otherTenant, "OWNER");
    const otherMember = await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: otherTenant.organization.id,
        branchId: otherTenant.branch.id,
        firstName: "Fresh",
        lastName: "Org",
        phone: `+9195${generateId().slice(-9)}`,
      },
    });

    const theirs = await raise(otherOwner, {
      memberId: otherMember.id,
      amountTotal: 10,
      notes: "first ever",
    });

    // A brand new organization starts at 1 no matter how many invoices the others have raised.
    expect(theirs.invoiceNumber).toBe(`INV-${new Date().getUTCFullYear()}-000001`);
  });

  /**
   * Locked Decision 1.16.4, and the same shape of race as the Phase 1 duplicate-phone test: the
   * sequence row is locked FOR UPDATE inside each invoice's own transaction, so concurrent
   * creators serialize. Without the lock, two of these would read the same `nextValue` and either
   * collide on the unique index or (worse, if the index were missing) duplicate a number.
   */
  it("race condition: ten concurrent creates produce ten distinct, gapless numbers", async () => {
    const raceTenant = await createTestTenant("InvoiceRace");
    const member = await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: raceTenant.organization.id,
        branchId: raceTenant.branch.id,
        firstName: "Race",
        lastName: "Payer",
        phone: `+9194${generateId().slice(-9)}`,
      },
    });

    const scope = { organizationId: raceTenant.organization.id, branchId: null };

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        invoiceService.create(scope, {
          memberId: member.id,
          amountTotal: 100 + i,
          notes: `concurrent ${i}`,
        }),
      ),
    );

    const numbers = results.map((invoice) => invoice.invoiceNumber);
    expect(new Set(numbers).size).toBe(10);

    // Not just distinct — contiguous. A gap would mean a number was allocated and thrown away,
    // which is exactly what "the increment lives in the same transaction" is supposed to prevent.
    const sequences = numbers.map((n) => Number(n.split("-")[2])).sort((a, b) => a - b);
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // And the database agrees — ten rows, ten numbers, no duplicate slipped past.
    const stored = await prisma.invoice.findMany({
      where: { organizationId: raceTenant.organization.id },
      select: { invoiceNumber: true },
    });
    expect(stored).toHaveLength(10);
    expect(new Set(stored.map((r) => r.invoiceNumber)).size).toBe(10);

    const sequence = await prisma.invoiceSequence.findFirstOrThrow({
      where: { organizationId: raceTenant.organization.id },
    });
    expect(sequence.nextValue).toBe(11);
  });
});

describe("invoices — list, filter and view", () => {
  it("filters to outstanding bills, searches by number and by member, and paginates", async () => {
    const listTenant = await createTestTenant("InvoiceList");
    const listOwner = await createActor(listTenant, "OWNER");

    const [ravi, sunita] = await Promise.all([
      prisma.member.create({
        data: {
          id: generateId(),
          organizationId: listTenant.organization.id,
          branchId: listTenant.branch.id,
          firstName: "Ravi",
          lastName: "Kumar",
          phone: `+9193${generateId().slice(-9)}`,
        },
      }),
      prisma.member.create({
        data: {
          id: generateId(),
          organizationId: listTenant.organization.id,
          branchId: listTenant.branch.id,
          firstName: "Sunita",
          lastName: "Rao",
          phone: `+9192${generateId().slice(-9)}`,
        },
      }),
    ]);

    const raviOne = await raise(listOwner, { memberId: ravi.id, amountTotal: 100, notes: "one" });
    await raise(listOwner, { memberId: ravi.id, amountTotal: 200, notes: "two" });
    await raise(listOwner, { memberId: sunita.id, amountTotal: 300, notes: "three" });
    // Settled, so it should drop out of the outstanding view.
    const settled = await raise(listOwner, {
      memberId: sunita.id,
      amountTotal: 0,
      notes: "comped",
    });

    const all = await request(app)
      .get(`${url(listOwner)}?limit=50`)
      .set(...bearer(listOwner));
    expect(all.body.pagination.total).toBe(4);

    const outstanding = await request(app)
      .get(`${url(listOwner)}?outstanding=true&limit=50`)
      .set(...bearer(listOwner));
    expect(outstanding.body.pagination.total).toBe(3);
    expect(outstanding.body.data.map((i: InvoiceBody) => i.id)).not.toContain(settled.id);

    const byNumber = await request(app)
      .get(`${url(listOwner)}?search=${raviOne.invoiceNumber}`)
      .set(...bearer(listOwner));
    expect(byNumber.body.pagination.total).toBe(1);
    expect(byNumber.body.data[0].id).toBe(raviOne.id);

    const byMember = await request(app)
      .get(`${url(listOwner)}?search=Sunita&limit=50`)
      .set(...bearer(listOwner));
    expect(byMember.body.pagination.total).toBe(2);

    const byMemberId = await request(app)
      .get(`${url(listOwner)}?memberId=${ravi.id}`)
      .set(...bearer(listOwner));
    expect(byMemberId.body.pagination.total).toBe(2);

    const paged = await request(app)
      .get(`${url(listOwner)}?limit=2&sortBy=amountTotal&sortOrder=desc`)
      .set(...bearer(listOwner));
    expect(paged.body.pagination.totalPages).toBe(2);
    expect(paged.body.data[0].amountTotal).toBe("300.00");
  });

  it("404s on an invoice belonging to another organization", async () => {
    const stranger = await createTestTenant("InvoicePeek");
    const strangerOwner = await createActor(stranger, "OWNER");
    const strangerMember = await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: stranger.organization.id,
        branchId: stranger.branch.id,
        firstName: "Not",
        lastName: "Yours",
        phone: `+9191${generateId().slice(-9)}`,
      },
    });
    const theirs = await raise(strangerOwner, {
      memberId: strangerMember.id,
      amountTotal: 100,
      notes: "private",
    });

    const res = await request(app)
      .get(url(owner, `/${theirs.id}`))
      .set(...bearer(owner));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("INVOICE_NOT_FOUND");
  });

  it("hides another branch's invoices from a branch-scoped caller", async () => {
    const otherBranch = await prisma.branch.create({
      data: {
        id: generateId(),
        organizationId: tenant.organization.id,
        name: `Annexe ${generateId().slice(-4)}`,
      },
    });
    const elsewhere = await createMember({ branchId: otherBranch.id });
    const invoice = await raise(owner, {
      memberId: elsewhere.id,
      amountTotal: 400,
      notes: "other branch",
    });

    // The receptionist is scoped to tenant.branch, so this belongs to someone else's branch.
    const res = await request(app)
      .get(url(receptionist, `/${invoice.id}`))
      .set(...bearer(receptionist));
    expect(res.status).toBe(404);
  });
});

describe("invoices — cancel (1.16.2)", () => {
  it("cancels an unpaid invoice and refuses to cancel it twice", async () => {
    const member = await createMember();
    const invoice = await raise(owner, { memberId: member.id, amountTotal: 750, notes: "typo" });

    const cancelled = await request(app)
      .post(url(owner, `/${invoice.id}/cancel`))
      .set(...bearer(owner));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe("CANCELLED");

    const again = await request(app)
      .post(url(owner, `/${invoice.id}/cancel`))
      .set(...bearer(owner));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INVOICE_NOT_PAYABLE");
  });

  it("refuses to cancel an invoice that has money against it", async () => {
    const member = await createMember();
    const invoice = await raise(owner, { memberId: member.id, amountTotal: 500, notes: "paid" });

    await request(app)
      .post(`/api/v1/organizations/${owner.organization.id}/payments`)
      .set(...bearer(owner))
      .send({ invoiceId: invoice.id, amount: 200, method: "CASH" });

    const res = await request(app)
      .post(url(owner, `/${invoice.id}/cancel`))
      .set(...bearer(owner));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVOICE_NOT_PAYABLE");
    expect(res.body.error.message).toMatch(/refund that before cancelling/);
  });

  it("stops owing anything once cancelled, and leaves the pending-fees list", async () => {
    const member = await createMember();
    const invoice = await raise(owner, { memberId: member.id, amountTotal: 750, notes: "void me" });
    expect(invoice.amountPending).toBe("750.00");

    const cancelled = await request(app)
      .post(url(owner, `/${invoice.id}/cancel`))
      .set(...bearer(owner));

    // A voided bill is owed nothing — otherwise it sits on the screen the front desk uses to
    // chase money, and in the member's outstanding total, forever.
    expect(cancelled.body.data.amountPending).toBe("0.00");
    // What was owed is still recoverable: the amount billed is never rewritten.
    expect(cancelled.body.data.amountTotal).toBe("750.00");
    expect(cancelled.body.data.amountPaid).toBe("0.00");

    const outstanding = await request(app)
      .get(url(owner))
      .query({ outstanding: "true", memberId: member.id })
      .set(...bearer(owner));
    expect(outstanding.body.data.map((i: { id: string }) => i.id)).not.toContain(invoice.id);

    // It is still findable — cancelled is a state, not a delete.
    const byStatus = await request(app)
      .get(url(owner))
      .query({ status: "CANCELLED", memberId: member.id })
      .set(...bearer(owner));
    expect(byStatus.body.data.map((i: { id: string }) => i.id)).toContain(invoice.id);
  });
});

describe("invoices — RBAC (Section 4.2)", () => {
  it("lets an ACCOUNTANT raise, read and cancel", async () => {
    const member = await createMember();
    const invoice = await raise(accountant, {
      memberId: member.id,
      amountTotal: 900,
      notes: "accountant",
    });

    const read = await request(app)
      .get(url(accountant, `/${invoice.id}`))
      .set(...bearer(accountant));
    expect(read.status).toBe(200);

    const cancelled = await request(app)
      .post(url(accountant, `/${invoice.id}/cancel`))
      .set(...bearer(accountant));
    expect(cancelled.status).toBe(200);
  });

  it("lets a MANAGER raise one — selling a term already bills the member", async () => {
    const member = await createMember();
    const res = await request(app)
      .post(url(manager))
      .set(...bearer(manager))
      .send({ memberId: member.id, amountTotal: 100, notes: "manager" });

    expect(res.status).toBe(201);
  });

  it("lets a RECEPTIONIST read but not raise or cancel", async () => {
    const member = await createMember();
    const invoice = await raise(owner, { memberId: member.id, amountTotal: 100, notes: "front desk" });

    const list = await request(app)
      .get(url(receptionist))
      .set(...bearer(receptionist));
    expect(list.status).toBe(200);

    const create = await request(app)
      .post(url(receptionist))
      .set(...bearer(receptionist))
      .send({ memberId: member.id, amountTotal: 100, notes: "nope" });
    expect(create.status).toBe(403);
    expect(create.body.error.code).toBe("PERMISSION_DENIED");

    const cancel = await request(app)
      .post(url(receptionist, `/${invoice.id}/cancel`))
      .set(...bearer(receptionist));
    expect(cancel.status).toBe(403);
  });

  it("denies a TRAINER entirely", async () => {
    const res = await request(app)
      .get(url(trainer))
      .set(...bearer(trainer));
    expect(res.status).toBe(403);
  });

  it("denies another organization's owner", async () => {
    const stranger = await createTestTenant("InvoiceTenant");
    const strangerOwner = await createActor(stranger, "OWNER");

    const res = await request(app)
      .get(url(owner))
      .set(...bearer(strangerOwner));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORG_MISMATCH");
  });
});
