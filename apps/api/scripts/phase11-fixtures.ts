/**
 * Phase 11 verification fixtures. Idempotent — safe to re-run before every browser pass.
 *
 *   cd apps/api && pnpm tsx scripts/phase11-fixtures.ts
 *
 * Puts one branch rent, one org-level software subscription, and (if Phase 8's Andheri branch
 * exists) one other-branch utility so the harness can show 1.21.1 rather than invent it: the
 * org-wide P&L includes Zoom, a Main-Branch P&L does not. Namespaced on payee `P11 …`. Also
 * syncs the permission catalog so an accountant seeded before Phase 11 actually holds
 * `expenses.manage`, and upserts a demo manager so the 4.2 split (P&L yes, expense CRUD no)
 * has a login.
 */
import { Prisma } from "@prisma/client";
import { generateId } from "../src/lib/id";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/lib/prisma";
import { syncOrganizationRoleMatrix, syncPermissionCatalog } from "../src/lib/rbac-catalog";
import { formatCalendarDate, localCalendarDate, safeTimeZone } from "../src/utils/dates";

const ORG_SLUG = "demo-gym";
const PASSWORD = "ChangeMe123!";
const SECOND_BRANCH_NAME = "P8 Andheri";

export const PAYEE_PREFIX = "P11 ";

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
    where: { organizationId: organization.id, name: { not: SECOND_BRANCH_NAME } },
    orderBy: { createdAt: "asc" },
  });
  if (!mainBranch) {
    throw new Error("Demo Gym has no main branch. Run the seed script first.");
  }

  let andheri = await prisma.branch.findFirst({
    where: { organizationId: organization.id, name: SECOND_BRANCH_NAME },
  });
  if (!andheri) {
    andheri = await prisma.branch.create({
      data: {
        id: generateId(),
        organizationId: organization.id,
        name: SECOND_BRANCH_NAME,
      },
    });
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

  const accountant = await prisma.user.findFirstOrThrow({
    where: { organizationId: organization.id, email: "accounts@demo-gym.test", deletedAt: null },
  });

  await prisma.expense.deleteMany({
    where: { organizationId: organization.id, paidTo: { startsWith: PAYEE_PREFIX } },
  });

  const today = formatCalendarDate(localCalendarDate(new Date(), safeTimeZone(organization.timezone)));

  await prisma.expense.create({
    data: {
      id: generateId(),
      organizationId: organization.id,
      branchId: mainBranch.id,
      category: "RENT",
      amount: new Prisma.Decimal("8000.00"),
      expenseDate: new Date(`${today}T00:00:00.000Z`),
      paidTo: `${PAYEE_PREFIX}Main Rent`,
      notes: "September rent",
      createdByUserId: accountant.id,
    },
  });

  await prisma.expense.create({
    data: {
      id: generateId(),
      organizationId: organization.id,
      branchId: null,
      category: "SOFTWARE",
      amount: new Prisma.Decimal("500.00"),
      expenseDate: new Date(`${today}T00:00:00.000Z`),
      paidTo: `${PAYEE_PREFIX}Zoom`,
      notes: "Org-level subscription",
      createdByUserId: accountant.id,
    },
  });

  await prisma.expense.create({
    data: {
      id: generateId(),
      organizationId: organization.id,
      branchId: andheri.id,
      category: "UTILITIES",
      amount: new Prisma.Decimal("1200.00"),
      expenseDate: new Date(`${today}T00:00:00.000Z`),
      paidTo: `${PAYEE_PREFIX}Andheri Power`,
      notes: "Other-branch cost",
      createdByUserId: accountant.id,
    },
  });

  const count = await prisma.expense.count({
    where: { organizationId: organization.id, paidTo: { startsWith: PAYEE_PREFIX } },
  });
  console.log(
    `Phase 11 fixtures: ${count} expenses (payee ${PAYEE_PREFIX}…), gym-local date ${today}, including ${SECOND_BRANCH_NAME}`,
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
