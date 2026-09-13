/**
 * Phase 12 verification fixtures. Idempotent — safe to re-run before every browser pass.
 *
 *   cd apps/api && pnpm tsx scripts/phase12-fixtures.ts
 *
 * Puts one membership inside the 7-day expiry window, one frozen term whose stored endDate is
 * also inside it (must not notify, 1.18.4 / 1.22.2), one term 20 days out, one unpaid invoice
 * and one cancelled invoice. Namespaced on `+9190001…`. Syncs `notifications.manage` and default
 * SMS templates so a gym seeded before Phase 12 still has both.
 */
import { Prisma } from "@prisma/client";
import { generateId } from "../src/lib/id";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/lib/prisma";
import { syncOrganizationRoleMatrix, syncPermissionCatalog } from "../src/lib/rbac-catalog";
import { ensureDefaultTemplates } from "../src/services/notification/templates";
import { addDays, todayUtc } from "../src/utils/dates";

const ORG_SLUG = "demo-gym";
const PASSWORD = "ChangeMe123!";
export const MEMBER_PHONE_PREFIX = "+9190001";
export const PLAN_NAME = "P12 Notify Gold";

const STAFF = [
  { email: "reception@demo-gym.test", name: "Demo Receptionist", role: "RECEPTIONIST", branchScoped: true },
  { email: "trainer@demo-gym.test", name: "Demo Trainer", role: "TRAINER", branchScoped: true },
  { email: "accounts@demo-gym.test", name: "Demo Accountant", role: "ACCOUNTANT", branchScoped: false },
  { email: "manager@demo-gym.test", name: "Demo Manager", role: "MANAGER", branchScoped: false },
] as const;

async function main() {
  const organization = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!organization) {
    throw new Error(`No "${ORG_SLUG}" organization. Run \`pnpm prisma db seed\` first.`);
  }

  const mainBranch = await prisma.branch.findFirst({
    where: { organizationId: organization.id },
    orderBy: { createdAt: "asc" },
  });
  if (!mainBranch) throw new Error("Demo Gym has no branch.");

  const organizationId = organization.id;
  const branchId = mainBranch.id;

  await syncPermissionCatalog();
  const roleIdByName = await syncOrganizationRoleMatrix(organization.id);
  await ensureDefaultTemplates(organization.id);

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
        data: { id: generateId(), organizationId: organization.id, email: person.email, ...data },
      });
    }
  }

  const p12Members = await prisma.member.findMany({
    where: { organizationId: organization.id, phone: { startsWith: MEMBER_PHONE_PREFIX } },
    select: { id: true },
  });
  const ids = p12Members.map((row) => row.id);

  await prisma.notificationLog.deleteMany({
    where: {
      organizationId: organization.id,
      OR: [
        ...(ids.length > 0 ? [{ memberId: { in: ids } }] : []),
        { body: { contains: "Expiry Soon" } },
        { body: { contains: "Owing Balance" } },
        { body: { contains: "Frozen Hold" } },
        { body: { contains: "Far Away" } },
      ],
    },
  });
  if (ids.length > 0) {
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
        price: new Prisma.Decimal("1500.00"),
        durationDays: 30,
      },
    });
  }

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
      },
    });
  }

  async function term(
    memberId: string,
    end: Date,
    status: "ACTIVE" | "FROZEN" = "ACTIVE",
  ) {
    return prisma.membership.create({
      data: {
        id: generateId(),
        organizationId,
        branchId,
        memberId,
        planId: plan!.id,
        priceAtPurchase: plan!.price,
        durationDaysAtPurchase: plan!.durationDays,
        startDate: addDays(today, -20),
        endDate: end,
        status,
        frozenAt: status === "FROZEN" ? new Date() : null,
      },
    });
  }

  const expiry = await person("Expiry", "Soon", `${MEMBER_PHONE_PREFIX}00001`);
  const frozen = await person("Frozen", "Hold", `${MEMBER_PHONE_PREFIX}00002`);
  const far = await person("Far", "Away", `${MEMBER_PHONE_PREFIX}00003`);
  const owing = await person("Owing", "Balance", `${MEMBER_PHONE_PREFIX}00004`);

  await term(expiry.id, addDays(today, 3));
  await term(frozen.id, addDays(today, 3), "FROZEN");
  await term(far.id, addDays(today, 20));
  await term(owing.id, addDays(today, 40));

  await prisma.invoice.create({
    data: {
      id: generateId(),
      organizationId: organization.id,
      branchId: mainBranch.id,
      memberId: owing.id,
      invoiceNumber: `INV-P12-${generateId().slice(-6)}`,
      amountTotal: new Prisma.Decimal("1500.00"),
      amountPaid: new Prisma.Decimal("0.00"),
      amountPending: new Prisma.Decimal("1500.00"),
      status: "UNPAID",
    },
  });
  await prisma.invoice.create({
    data: {
      id: generateId(),
      organizationId: organization.id,
      branchId: mainBranch.id,
      memberId: owing.id,
      invoiceNumber: `INV-P12C-${generateId().slice(-6)}`,
      amountTotal: new Prisma.Decimal("400.00"),
      amountPaid: new Prisma.Decimal("0.00"),
      amountPending: new Prisma.Decimal("0.00"),
      status: "CANCELLED",
    },
  });

  console.log(
    `Phase 12 fixtures: Expiry Soon (end ${addDays(today, 3).toISOString().slice(0, 10)}), Frozen Hold, Far Away, Owing Balance + unpaid invoice.`,
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
