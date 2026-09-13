/**
 * Phase 5 verification fixtures. Idempotent — safe to re-run before every browser pass.
 *
 *   cd apps/api && pnpm tsx scripts/phase5-fixtures.ts
 *
 * Provides what the membership-lifecycle checks need and the seed script doesn't:
 *   1. A real RECEPTIONIST login in the seeded Demo Gym, scoped to Main Branch, so the Section 4.2
 *      split (can sell and renew, cannot freeze or cancel) is verified with an actual session
 *      rather than by reading the permission matrix.
 *   2. One member per lifecycle scenario, so no scenario can be polluted by another's leftovers —
 *      the "one live membership per member" rule (1.15.1) makes sharing a member impossible anyway.
 *   3. A second sellable plan, so mid-term plan changes and renew-onto-a-different-plan have a
 *      target. The *first* plan is deliberately created through the UI by the harness, since plan
 *      CRUD is itself part of what Phase 5 has to demonstrate.
 *
 * Everything this script and the harness create is namespaced — members on `+9197777…`, plans
 * named `E2E …` — so cleanup is precise and real data is never touched.
 */
import { generateId } from "../src/lib/id";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/lib/prisma";
import { syncOrganizationRoleMatrix, syncPermissionCatalog } from "../src/lib/rbac-catalog";

const ORG_SLUG = "demo-gym";
const RECEPTIONIST_EMAIL = "reception@demo-gym.test";
const RECEPTIONIST_PASSWORD = "ChangeMe123!";

/** Namespaces owned by Phase 5's fixtures and harness. */
export const MEMBER_PHONE_PREFIX = "+9197777";
export const PLAN_NAME_PREFIX = "E2E ";

/** The plan the harness switches *to*; the one it switches *from* is created through the UI. */
const TARGET_PLAN = { name: `${PLAN_NAME_PREFIX}Platinum`, price: 4000, durationDays: 90 };

const SCENARIO_MEMBERS = [
  { key: "snapshot", firstName: "Anita", lastName: "Snapshot" },
  { key: "freeze", firstName: "Bikram", lastName: "Freeze" },
  { key: "cancel", firstName: "Chandni", lastName: "Cancel" },
  { key: "expiry", firstName: "Deepak", lastName: "Expiry" },
  { key: "reception", firstName: "Ekta", lastName: "Walkin" },
  { key: "switch", firstName: "Farida", lastName: "Switch" },
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
  const receptionistRoleId = roleIdByName.get("RECEPTIONIST")!;

  const existingReceptionist = await prisma.user.findFirst({
    where: { organizationId: organization.id, email: RECEPTIONIST_EMAIL, deletedAt: null },
  });

  const receptionist = existingReceptionist
    ? await prisma.user.update({
        where: { id: existingReceptionist.id },
        // Reset each run so a half-finished earlier pass can't make the RBAC check fail for the
        // wrong reason. The role matrix sync above also re-grants Phase 5's new permission keys.
        data: {
          passwordHash: await hashPassword(RECEPTIONIST_PASSWORD),
          roleId: receptionistRoleId,
          branchId: branch.id,
          status: "ACTIVE",
        },
      })
    : await prisma.user.create({
        data: {
          id: generateId(),
          organizationId: organization.id,
          name: "Demo Receptionist",
          email: RECEPTIONIST_EMAIL,
          passwordHash: await hashPassword(RECEPTIONIST_PASSWORD),
          roleId: receptionistRoleId,
          branchId: branch.id,
        },
      });

  // Memberships first: they reference both members and plans. `previousMembershipId` is
  // ON DELETE SET NULL, so a chain deletes in one statement without ordering games.
  const removedMemberships = await prisma.membership.deleteMany({
    where: {
      organizationId: organization.id,
      OR: [
        { member: { phone: { startsWith: MEMBER_PHONE_PREFIX } } },
        { plan: { name: { startsWith: PLAN_NAME_PREFIX } } },
      ],
    },
  });
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
    await prisma.payment.deleteMany({
      where: { memberId: { in: memberIds }, refundOfPaymentId: { not: null } },
    });
    await prisma.payment.deleteMany({ where: { memberId: { in: memberIds } } });
    await prisma.invoice.deleteMany({ where: { memberId: { in: memberIds } } });
    await prisma.attendance.deleteMany({ where: { memberId: { in: memberIds } } });
  }
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
        email: `${person.firstName.toLowerCase()}@demo-gym.test`,
      },
    });
  }

  const targetPlan = await prisma.membershipPlan.create({
    data: {
      id: generateId(),
      organizationId: organization.id,
      name: TARGET_PLAN.name,
      price: TARGET_PLAN.price,
      durationDays: TARGET_PLAN.durationDays,
    },
  });

  console.log(`
Phase 5 fixtures ready
  organization : ${organization.name} (${organization.id})
  branch       : ${branch.name} (${branch.id})
  receptionist : ${RECEPTIONIST_EMAIL} / ${RECEPTIONIST_PASSWORD} (branch-scoped, ${receptionist.id})
  cleaned up   : ${removedMemberships.count} membership(s), ${removedMembers.count} member(s), ${removedPlans.count} plan(s)
  members      : ${SCENARIO_MEMBERS.map((m) => `${m.firstName} ${m.lastName}`).join(", ")}
  target plan  : ${targetPlan.name} — ${TARGET_PLAN.price} / ${TARGET_PLAN.durationDays}d (${targetPlan.id})
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
