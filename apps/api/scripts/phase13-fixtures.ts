/**
 * Phase 13 verification fixtures. Idempotent.
 *
 *   cd apps/api && pnpm tsx scripts/phase13-fixtures.ts
 *
 * Two portal-enabled members in Demo Gym (phone prefix +9191111). Alice has a live membership,
 * one attendance row, one payment and an outstanding invoice. Bob has his own term, payment and
 * attendance so the harness can prove Alice never sees Bob's numbers.
 */
import { Prisma } from "@prisma/client";
import { generateId } from "../src/lib/id";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/lib/prisma";
import { addDays, todayUtc } from "../src/utils/dates";

const ORG_SLUG = "demo-gym";
const PASSWORD = "ChangeMe123!";
export const MEMBER_PHONE_PREFIX = "+9191111";
export const PLAN_NAME = "P13 Portal Gold";

async function main() {
  const organization = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!organization) {
    throw new Error(`No "${ORG_SLUG}" organization. Run \`pnpm prisma db seed\` first.`);
  }
  const branch = await prisma.branch.findFirst({
    where: { organizationId: organization.id },
    orderBy: { createdAt: "asc" },
  });
  if (!branch) throw new Error("Demo Gym has no branch.");
  const organizationId = organization.id;
  const branchId = branch.id;

  const existing = await prisma.member.findMany({
    where: { organizationId: organization.id, phone: { startsWith: MEMBER_PHONE_PREFIX } },
    select: { id: true },
  });
  const ids = existing.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.memberRefreshToken.deleteMany({ where: { memberId: { in: ids } } });
    await prisma.attendance.deleteMany({ where: { memberId: { in: ids } } });
    await prisma.payment.deleteMany({ where: { memberId: { in: ids } } });
    await prisma.invoice.deleteMany({ where: { memberId: { in: ids } } });
    await prisma.membership.deleteMany({ where: { memberId: { in: ids } } });
    await prisma.member.deleteMany({ where: { id: { in: ids } } });
  }

  let plan = await prisma.membershipPlan.findFirst({
    where: { organizationId: organization.id, name: PLAN_NAME },
  });
  if (!plan) {
    plan = await prisma.membershipPlan.create({
      data: {
        id: generateId(),
        organizationId: organization.id,
        name: PLAN_NAME,
        price: new Prisma.Decimal("2000.00"),
        durationDays: 30,
      },
    });
  }

  const passwordHash = await hashPassword(PASSWORD);
  const today = todayUtc();

  async function person(first: string, last: string, phone: string) {
    return prisma.member.create({
      data: {
        id: generateId(),
        organizationId,
        branchId,
        firstName: first,
        lastName: last,
        phone,
        passwordHash,
      },
    });
  }

  const alice = await person("Alice", "Portal", `${MEMBER_PHONE_PREFIX}00001`);
  const bob = await person("Bob", "Other", `${MEMBER_PHONE_PREFIX}00002`);

  const aliceTerm = await prisma.membership.create({
    data: {
      id: generateId(),
      organizationId,
      branchId,
      memberId: alice.id,
      planId: plan.id,
      priceAtPurchase: plan.price,
      durationDaysAtPurchase: plan.durationDays,
      startDate: addDays(today, -5),
      endDate: addDays(today, 10),
      status: "ACTIVE",
    },
  });
  await prisma.membership.create({
    data: {
      id: generateId(),
      organizationId,
      branchId,
      memberId: bob.id,
      planId: plan.id,
      priceAtPurchase: plan.price,
      durationDaysAtPurchase: plan.durationDays,
      startDate: addDays(today, -5),
      endDate: addDays(today, 10),
      status: "ACTIVE",
    },
  });

  const aliceInvoice = await prisma.invoice.create({
    data: {
      id: generateId(),
      organizationId,
      branchId,
      memberId: alice.id,
      membershipId: aliceTerm.id,
      invoiceNumber: `INV-P13-${generateId().slice(-6)}`,
      amountTotal: new Prisma.Decimal("2000.00"),
      amountPaid: new Prisma.Decimal("500.00"),
      amountPending: new Prisma.Decimal("1500.00"),
      status: "PARTIALLY_PAID",
    },
  });
  await prisma.invoice.create({
    data: {
      id: generateId(),
      organizationId,
      branchId,
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
      organizationId,
      branchId,
      memberId: alice.id,
      membershipId: aliceTerm.id,
      invoiceId: aliceInvoice.id,
      amount: new Prisma.Decimal("500.00"),
      method: "UPI",
      status: "SUCCESS",
    },
  });
  await prisma.payment.create({
    data: {
      id: generateId(),
      organizationId,
      branchId,
      memberId: bob.id,
      amount: new Prisma.Decimal("111.00"),
      method: "CASH",
      status: "SUCCESS",
    },
  });

  await prisma.attendance.create({
    data: {
      id: generateId(),
      organizationId,
      branchId,
      memberId: alice.id,
      membershipId: aliceTerm.id,
      checkedInAt: new Date(),
      attendanceDate: today,
    },
  });
  await prisma.attendance.create({
    data: {
      id: generateId(),
      organizationId,
      branchId,
      memberId: bob.id,
      checkedInAt: new Date(),
      attendanceDate: today,
    },
  });

  console.log(
    `Phase 13 fixtures: Alice Portal ${MEMBER_PHONE_PREFIX}00001 / ${PASSWORD}, Bob Other ${MEMBER_PHONE_PREFIX}00002. Org slug ${ORG_SLUG}.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
