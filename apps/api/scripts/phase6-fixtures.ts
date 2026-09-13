/**
 * Phase 6 verification fixtures. Idempotent — safe to re-run before every browser pass.
 *
 *   cd apps/api && pnpm tsx scripts/phase6-fixtures.ts
 *
 * Provides what the payments/invoicing checks need and the seed script doesn't:
 *   1. A real ACCOUNTANT login and a real RECEPTIONIST login in the seeded Demo Gym, because
 *      "ACCOUNTANT can refund, RECEPTIONIST cannot" (Section 4.2) has to be shown with two actual
 *      sessions rather than by reading the permission matrix.
 *   2. One member per scenario, so a partial-payment run can't be polluted by a refund run's
 *      leftovers.
 *   3. A sellable plan, so the "selling a term raises its own invoice" check has something to
 *      sell. Ad-hoc invoices are raised through the UI by the harness, since invoice CRUD is
 *      itself part of what Phase 6 has to demonstrate.
 *
 * Everything this script and the harness create is namespaced — members on `+9196666…`, the plan
 * named `P6 …` — so cleanup is precise and real data is never touched. Invoices and payments are
 * deleted by walking back from those members, since financial rows have no namespace of their own.
 */
import { generateId } from "../src/lib/id";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/lib/prisma";
import { syncOrganizationRoleMatrix, syncPermissionCatalog } from "../src/lib/rbac-catalog";

const ORG_SLUG = "demo-gym";
const PASSWORD = "ChangeMe123!";

const STAFF = [
  { email: "accounts@demo-gym.test", name: "Demo Accountant", role: "ACCOUNTANT", branchScoped: false },
  { email: "reception@demo-gym.test", name: "Demo Receptionist", role: "RECEPTIONIST", branchScoped: true },
] as const;

/** Namespaces owned by Phase 6's fixtures and harness. */
export const MEMBER_PHONE_PREFIX = "+9196666";
export const PLAN_NAME_PREFIX = "P6 ";

const PLAN = { name: `${PLAN_NAME_PREFIX}Gold`, price: 1000, durationDays: 30 };

const SCENARIO_MEMBERS = [
  { key: "partial", firstName: "Priya", lastName: "Partial" },
  { key: "refund", firstName: "Rohit", lastName: "Refund" },
  { key: "overpay", firstName: "Omar", lastName: "Overpay" },
  { key: "sale", firstName: "Sneha", lastName: "Sale" },
  { key: "rbac", firstName: "Rekha", lastName: "Rbac" },
  { key: "race", firstName: "Ranjit", lastName: "Race" },
] as const;

async function main() {
  const organization = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!organization) {
    throw new Error(`No "${ORG_SLUG}" organization. Run \`pnpm prisma db seed\` first.`);
  }

  const branch = await prisma.branch.findFirst({
    where: { organizationId: organization.id },
    orderBy: { createdAt: "asc" },
  });
  if (!branch) {
    throw new Error("Demo Gym has no branch. Run the seed script first.");
  }

  await syncPermissionCatalog();
  const roleIdByName = await syncOrganizationRoleMatrix(organization.id);

  const staffIds: string[] = [];
  for (const person of STAFF) {
    const roleId = roleIdByName.get(person.role)!;
    const existing = await prisma.user.findFirst({
      where: { organizationId: organization.id, email: person.email, deletedAt: null },
    });

    // Reset each run so a half-finished earlier pass can't make an RBAC check fail for the wrong
    // reason. The role matrix sync above also re-grants Phase 6's new permission keys.
    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash: await hashPassword(PASSWORD),
            roleId,
            branchId: person.branchScoped ? branch.id : null,
            status: "ACTIVE",
          },
        })
      : await prisma.user.create({
          data: {
            id: generateId(),
            organizationId: organization.id,
            name: person.name,
            email: person.email,
            passwordHash: await hashPassword(PASSWORD),
            roleId,
            branchId: person.branchScoped ? branch.id : null,
          },
        });
    staffIds.push(`${person.role} ${person.email} (${user.id})`);
  }

  // Teardown order follows the foreign keys: audit entries and payments hang off invoices and
  // members, invoices hang off memberships, memberships hang off members and plans.
  const scopedMembers = await prisma.member.findMany({
    where: { organizationId: organization.id, phone: { startsWith: MEMBER_PHONE_PREFIX } },
    select: { id: true },
  });
  const memberIds = scopedMembers.map((m) => m.id);

  if (memberIds.length > 0) {
    const payments = await prisma.payment.findMany({
      where: { memberId: { in: memberIds } },
      select: { id: true },
    });
    await prisma.auditLog.deleteMany({
      where: { entityType: "Payment", entityId: { in: payments.map((p) => p.id) } },
    });
    // Refund rows reference the payments they reverse, so they have to go first.
    await prisma.payment.deleteMany({
      where: { memberId: { in: memberIds }, refundOfPaymentId: { not: null } },
    });
    await prisma.payment.deleteMany({ where: { memberId: { in: memberIds } } });
    await prisma.invoice.deleteMany({ where: { memberId: { in: memberIds } } });
  }

  const removedMemberships = await prisma.membership.deleteMany({
    where: {
      organizationId: organization.id,
      OR: [
        { member: { phone: { startsWith: MEMBER_PHONE_PREFIX } } },
        { plan: { name: { startsWith: PLAN_NAME_PREFIX } } },
      ],
    },
  });
  const removedMembers = await prisma.member.deleteMany({
    where: { organizationId: organization.id, phone: { startsWith: MEMBER_PHONE_PREFIX } },
  });
  const removedPlans = await prisma.membershipPlan.deleteMany({
    where: { organizationId: organization.id, name: { startsWith: PLAN_NAME_PREFIX } },
  });

  for (const [index, person] of SCENARIO_MEMBERS.entries()) {
    await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: organization.id,
        branchId: branch.id,
        firstName: person.firstName,
        lastName: person.lastName,
        phone: `${MEMBER_PHONE_PREFIX}${index.toString().padStart(5, "0")}`,
        email: `${person.firstName.toLowerCase()}.p6@demo-gym.test`,
      },
    });
  }

  const plan = await prisma.membershipPlan.create({
    data: {
      id: generateId(),
      organizationId: organization.id,
      name: PLAN.name,
      price: PLAN.price,
      durationDays: PLAN.durationDays,
    },
  });

  // Reported, not reset: the invoice sequence is deliberately left alone so a re-run proves
  // numbering keeps climbing rather than starting over (Locked Decision 1.16.4).
  const sequence = await prisma.invoiceSequence.findFirst({
    where: { organizationId: organization.id },
    orderBy: { year: "desc" },
  });

  console.log(`
Phase 6 fixtures ready
  organization : ${organization.name} (${organization.id})
  branch       : ${branch.name} (${branch.id})
  staff        : ${staffIds.join("\n                 ")}
  password     : ${PASSWORD}
  cleaned up   : ${removedMemberships.count} membership(s), ${removedMembers.count} member(s), ${removedPlans.count} plan(s), plus their invoices/payments/audit rows
  members      : ${SCENARIO_MEMBERS.map((m) => `${m.firstName} ${m.lastName}`).join(", ")}
  plan         : ${plan.name} — ${PLAN.price} / ${PLAN.durationDays}d (${plan.id})
  invoice seq  : ${sequence ? `${sequence.year} next=${sequence.nextValue} (left as-is on purpose)` : "none yet"}
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
