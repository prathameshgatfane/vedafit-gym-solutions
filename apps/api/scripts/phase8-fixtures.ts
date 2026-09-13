/**
 * Phase 8 verification fixtures. Idempotent — safe to re-run before every browser pass.
 *
 *   cd apps/api && pnpm tsx scripts/phase8-fixtures.ts
 *
 * The dashboard is the first screen that reads every prior module at once, so the fixtures have
 * to put known rows in all of them, on two branches, or "the number on screen matches SQL"
 * cannot actually be shown:
 *
 *   1. A second branch (`P8 Andheri`), so org-wide totals and a branch-scoped receptionist can
 *      be shown to disagree in the way 1.18.2 says they should.
 *   2. Members covering every headcount case: on the books with cover, on the books without,
 *      archived (must not count), and one who will be transferred mid-harness.
 *   3. Money: a collected payment, a refund, a failed payment that must not count, an unpaid
 *      invoice, a cancelled invoice that must not count as outstanding.
 *   4. A term ending inside the 7-day window and a frozen one whose stored endDate also falls
 *      inside it (1.18.4).
 *   5. Today's attendance at Main Branch only.
 *
 * Namespaced: members on `+9194444…`, the plan `P8 …`, the branch `P8 Andheri`.
 */
import { Prisma } from "@prisma/client";
import { generateId } from "../src/lib/id";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/lib/prisma";
import { syncOrganizationRoleMatrix, syncPermissionCatalog } from "../src/lib/rbac-catalog";
import {
  addDays,
  localCalendarDate,
  localMonthOf,
  safeTimeZone,
  todayUtc,
} from "../src/utils/dates";

const ORG_SLUG = "demo-gym";
const PASSWORD = "ChangeMe123!";

const STAFF = [
  { email: "reception@demo-gym.test", name: "Demo Receptionist", role: "RECEPTIONIST", branchScoped: true },
  { email: "trainer@demo-gym.test", name: "Demo Trainer", role: "TRAINER", branchScoped: true },
  { email: "accounts@demo-gym.test", name: "Demo Accountant", role: "ACCOUNTANT", branchScoped: false },
] as const;

export const MEMBER_PHONE_PREFIX = "+9194444";
export const PLAN_NAME_PREFIX = "P8 ";
export const SECOND_BRANCH_NAME = "P8 Andheri";

const PLAN = { name: `${PLAN_NAME_PREFIX}Gold`, price: 1500, durationDays: 30 };

async function main() {
  const organization = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!organization) {
    throw new Error(`No "${ORG_SLUG}" organization. Run \`pnpm prisma db seed\` first.`);
  }

  const mainBranch = await prisma.branch.findFirst({
    where: { organizationId: organization.id, name: { not: SECOND_BRANCH_NAME } },
    orderBy: { createdAt: "asc" },
  });
  if (!mainBranch) {
    throw new Error("Demo Gym has no main branch. Run the seed script first.");
  }

  await syncPermissionCatalog();
  const roleIdByName = await syncOrganizationRoleMatrix(organization.id);

  for (const person of STAFF) {
    const roleId = roleIdByName.get(person.role)!;
    const existing = await prisma.user.findFirst({
      where: { organizationId: organization.id, email: person.email, deletedAt: null },
    });
    const data = {
      passwordHash: await hashPassword(PASSWORD),
      roleId,
      branchId: person.branchScoped ? mainBranch.id : null,
      name: person.name,
      status: "ACTIVE" as const,
    };
    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data });
    } else {
      await prisma.user.create({
        data: {
          id: generateId(),
          organizationId: organization.id,
          email: person.email,
          ...data,
        },
      });
    }
  }

  let secondBranch = await prisma.branch.findFirst({
    where: { organizationId: organization.id, name: SECOND_BRANCH_NAME },
  });
  if (!secondBranch) {
    secondBranch = await prisma.branch.create({
      data: {
        id: generateId(),
        organizationId: organization.id,
        name: SECOND_BRANCH_NAME,
        address: "Andheri West",
      },
    });
  }

  const members = await prisma.member.findMany({
    where: { organizationId: organization.id, phone: { startsWith: MEMBER_PHONE_PREFIX } },
    select: { id: true },
  });
  const memberIds = members.map((m) => m.id);

  if (memberIds.length > 0) {
    await prisma.attendance.deleteMany({ where: { memberId: { in: memberIds } } });
    await prisma.payment.deleteMany({ where: { memberId: { in: memberIds } } });
    await prisma.invoice.deleteMany({ where: { memberId: { in: memberIds } } });
    await prisma.membership.deleteMany({ where: { memberId: { in: memberIds } } });
    await prisma.member.deleteMany({ where: { id: { in: memberIds } } });
  }

  await prisma.membershipPlan.deleteMany({
    where: { organizationId: organization.id, name: { startsWith: PLAN_NAME_PREFIX } },
  });

  const plan = await prisma.membershipPlan.create({
    data: {
      id: generateId(),
      organizationId: organization.id,
      name: PLAN.name,
      price: new Prisma.Decimal(PLAN.price),
      durationDays: PLAN.durationDays,
    },
  });

  const timeZone = safeTimeZone(organization.timezone);
  const today = todayUtc();
  const gymToday = localCalendarDate(new Date(), timeZone);
  const thisMonth = localMonthOf(new Date(), timeZone);

  const person = async (
    firstName: string,
    lastName: string,
    phone: string,
    branchId: string,
    status: "ACTIVE" | "ARCHIVED" = "ACTIVE",
  ) =>
    prisma.member.create({
      data: {
        id: generateId(),
        organizationId: organization.id,
        branchId,
        firstName,
        lastName,
        phone,
        status,
      },
    });

  const covering = await person("Maya", "Covering", `${MEMBER_PHONE_PREFIX}00001`, mainBranch.id);
  const _onBooks = await person("Neil", "Onbooks", `${MEMBER_PHONE_PREFIX}00002`, mainBranch.id);
  const archived = await person("Archie", "Archived", `${MEMBER_PHONE_PREFIX}00003`, mainBranch.id, "ARCHIVED");
  const owing = await person("Omkar", "Owing", `${MEMBER_PHONE_PREFIX}00004`, mainBranch.id);
  const cancelledBill = await person("Cora", "Cancelled", `${MEMBER_PHONE_PREFIX}00005`, mainBranch.id);
  const soon = await person("Sia", "Soon", `${MEMBER_PHONE_PREFIX}00006`, mainBranch.id);
  const frozen = await person("Farah", "Frozen", `${MEMBER_PHONE_PREFIX}00007`, mainBranch.id);
  const mover = await person("Mehul", "Mover", `${MEMBER_PHONE_PREFIX}00008`, mainBranch.id);
  const andheri = await person("Anaya", "Andheri", `${MEMBER_PHONE_PREFIX}00009`, secondBranch.id);

  const term = async (
    memberId: string,
    branchId: string,
    options: { status?: "ACTIVE" | "FROZEN"; start?: Date; end?: Date } = {},
  ) =>
    prisma.membership.create({
      data: {
        id: generateId(),
        organizationId: organization.id,
        branchId,
        memberId,
        planId: plan.id,
        priceAtPurchase: new Prisma.Decimal(PLAN.price),
        durationDaysAtPurchase: PLAN.durationDays,
        startDate: options.start ?? addDays(today, -10),
        endDate: options.end ?? addDays(today, 19),
        status: options.status ?? "ACTIVE",
        frozenAt: options.status === "FROZEN" ? new Date() : null,
      },
    });

  const coveringTerm = await term(covering.id, mainBranch.id);
  await term(archived.id, mainBranch.id);
  await term(soon.id, mainBranch.id, { end: addDays(today, 3) });
  await term(frozen.id, mainBranch.id, { status: "FROZEN", end: addDays(today, 2) });
  const moverTerm = await term(mover.id, mainBranch.id);
  await term(andheri.id, secondBranch.id);

  const invoice = async (
    memberId: string,
    branchId: string,
    opts: {
      total: string;
      pending: string;
      paid: string;
      status: "UNPAID" | "PAID" | "CANCELLED" | "PARTIALLY_PAID";
      membershipId?: string;
    },
  ) =>
    prisma.invoice.create({
      data: {
        id: generateId(),
        organizationId: organization.id,
        branchId,
        memberId,
        membershipId: opts.membershipId ?? null,
        invoiceNumber: `INV-P8-${generateId().slice(-8)}`,
        amountTotal: new Prisma.Decimal(opts.total),
        amountPaid: new Prisma.Decimal(opts.paid),
        amountPending: new Prisma.Decimal(opts.pending),
        status: opts.status,
      },
    });

  const paid = await invoice(covering.id, mainBranch.id, {
    total: "1500.00",
    paid: "1500.00",
    pending: "0.00",
    status: "PAID",
    membershipId: coveringTerm.id,
  });
  await prisma.payment.create({
    data: {
      id: generateId(),
      organizationId: organization.id,
      branchId: mainBranch.id,
      memberId: covering.id,
      membershipId: coveringTerm.id,
      invoiceId: paid.id,
      amount: new Prisma.Decimal("1500.00"),
      method: "UPI",
      status: "SUCCESS",
    },
  });

  const refundInvoice = await invoice(covering.id, mainBranch.id, {
    total: "400.00",
    paid: "300.00",
    pending: "100.00",
    status: "PARTIALLY_PAID",
  });
  const original = await prisma.payment.create({
    data: {
      id: generateId(),
      organizationId: organization.id,
      branchId: mainBranch.id,
      memberId: covering.id,
      invoiceId: refundInvoice.id,
      amount: new Prisma.Decimal("400.00"),
      method: "CASH",
      status: "SUCCESS",
    },
  });
  await prisma.payment.create({
    data: {
      id: generateId(),
      organizationId: organization.id,
      branchId: mainBranch.id,
      memberId: covering.id,
      invoiceId: refundInvoice.id,
      amount: new Prisma.Decimal("-100.00"),
      method: "CASH",
      status: "REFUNDED",
      refundOfPaymentId: original.id,
    },
  });
  await prisma.payment.create({
    data: {
      id: generateId(),
      organizationId: organization.id,
      branchId: mainBranch.id,
      memberId: covering.id,
      invoiceId: refundInvoice.id,
      amount: new Prisma.Decimal("50.00"),
      method: "CASH",
      status: "FAILED",
    },
  });

  await invoice(owing.id, mainBranch.id, {
    total: "250.00",
    paid: "0.00",
    pending: "250.00",
    status: "UNPAID",
  });
  await invoice(cancelledBill.id, mainBranch.id, {
    total: "900.00",
    paid: "0.00",
    pending: "0.00",
    status: "CANCELLED",
  });

  const moverInvoice = await invoice(mover.id, mainBranch.id, {
    total: "1500.00",
    paid: "1500.00",
    pending: "0.00",
    status: "PAID",
    membershipId: moverTerm.id,
  });
  await prisma.payment.create({
    data: {
      id: generateId(),
      organizationId: organization.id,
      branchId: mainBranch.id,
      memberId: mover.id,
      membershipId: moverTerm.id,
      invoiceId: moverInvoice.id,
      amount: new Prisma.Decimal("1500.00"),
      method: "CARD",
      status: "SUCCESS",
    },
  });

  const andheriInvoice = await invoice(andheri.id, secondBranch.id, {
    total: "1500.00",
    paid: "1500.00",
    pending: "0.00",
    status: "PAID",
  });
  await prisma.payment.create({
    data: {
      id: generateId(),
      organizationId: organization.id,
      branchId: secondBranch.id,
      memberId: andheri.id,
      invoiceId: andheriInvoice.id,
      amount: new Prisma.Decimal("777.00"),
      method: "UPI",
      status: "SUCCESS",
    },
  });

  await prisma.attendance.create({
    data: {
      id: generateId(),
      organizationId: organization.id,
      branchId: mainBranch.id,
      memberId: covering.id,
      attendanceDate: gymToday,
      membershipId: coveringTerm.id,
    },
  });

  console.log("\nPhase 8 fixtures ready");
  console.log(`  organization : ${organization.name} (${organization.id})`);
  console.log(`  timezone     : ${timeZone} — gym month is ${thisMonth.year}-${String(thisMonth.month).padStart(2, "0")}`);
  console.log(`  branch       : ${mainBranch.name} (${mainBranch.id})`);
  console.log(`  branch 2     : ${secondBranch.name} (${secondBranch.id})`);
  console.log(`  password     : ${PASSWORD}`);
  console.log("  members      :");
  console.log(`                 Maya Covering  — ACTIVE term + ₹1500 + refund net ₹300 + failed ₹50`);
  console.log(`                 Neil Onbooks   — no membership`);
  console.log(`                 Archie Archived — must not count`);
  console.log(`                 Omkar Owing    — ₹250 outstanding`);
  console.log(`                 Cora Cancelled — cancelled ₹900, pending 0`);
  console.log(`                 Sia Soon       — expires in 3 days`);
  console.log(`                 Farah Frozen   — frozen, endDate in 2 days (must not list)`);
  console.log(`                 Mehul Mover    — paid ₹1500 at Main; harness transfers him`);
  console.log(`                 Anaya Andheri  — ₹777 collected at ${SECOND_BRANCH_NAME}`);
  console.log(`  on-books leftover (Neil) exists so total ≠ active`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
