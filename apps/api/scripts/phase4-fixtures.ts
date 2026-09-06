/**
 * Phase 4 verification fixtures. Idempotent — safe to re-run before every browser pass.
 *
 *   cd apps/api && pnpm tsx scripts/phase4-fixtures.ts
 *
 * Creates two things the Phase 4 checks need and the seed script doesn't provide:
 *   1. A real RECEPTIONIST login in the seeded Demo Gym, scoped to Main Branch, so RBAC can be
 *      verified with an actual session rather than by reading the permission matrix.
 *   2. A known 7-member dataset with a deliberate mix of statuses and a shared surname, so
 *      "search + status filter + pagination in combination" has an exact expected answer.
 *
 * Every fixture member's phone sits in the +9199000000xx range and every browser-created member
 * uses +9198888xxxxx, which keeps cleanup precise and leaves real data alone.
 */
import { generateId } from "../src/lib/id";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/lib/prisma";
import { syncOrganizationRoleMatrix, syncPermissionCatalog } from "../src/lib/rbac-catalog";

const ORG_SLUG = "demo-gym";
const RECEPTIONIST_EMAIL = "reception@demo-gym.test";
const RECEPTIONIST_PASSWORD = "ChangeMe123!";

/** Phone prefixes owned by this script and by the browser harness respectively. */
export const FIXTURE_PHONE_PREFIX = "+9199000000";
export const BROWSER_PHONE_PREFIX = "+9198888";

const FIXTURE_MEMBERS = [
  { firstName: "Aarav", lastName: "Singh", status: "ACTIVE" },
  { firstName: "Bhavna", lastName: "Singh", status: "ACTIVE" },
  { firstName: "Chetan", lastName: "Verma", status: "ACTIVE" },
  { firstName: "Divya", lastName: "Singh", status: "INACTIVE" },
  { firstName: "Esha", lastName: "Singh", status: "INACTIVE" },
  { firstName: "Farhan", lastName: "Khan", status: "ARCHIVED" },
  { firstName: "Gita", lastName: "Singh", status: "ARCHIVED" },
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
        // Reset the password and branch each run so a half-finished earlier pass can't leave the
        // fixture in a state that makes the RBAC check fail for the wrong reason.
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

  const removed = await prisma.member.deleteMany({
    where: {
      organizationId: organization.id,
      OR: [
        { phone: { startsWith: FIXTURE_PHONE_PREFIX } },
        { phone: { startsWith: BROWSER_PHONE_PREFIX } },
      ],
    },
  });

  for (const [index, person] of FIXTURE_MEMBERS.entries()) {
    await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: organization.id,
        branchId: branch.id,
        firstName: person.firstName,
        lastName: person.lastName,
        phone: `${FIXTURE_PHONE_PREFIX}${index.toString().padStart(2, "0")}`,
        email: `${person.firstName.toLowerCase()}@demo-gym.test`,
        status: person.status,
      },
    });
  }

  const counts = await prisma.member.groupBy({
    by: ["status"],
    where: { organizationId: organization.id, phone: { startsWith: FIXTURE_PHONE_PREFIX } },
    _count: true,
  });

  console.log(`
Phase 4 fixtures ready
  organization : ${organization.name} (${organization.id})
  branch       : ${branch.name} (${branch.id})
  receptionist : ${RECEPTIONIST_EMAIL} / ${RECEPTIONIST_PASSWORD} (branch-scoped, ${receptionist.id})
  cleaned up   : ${removed.count} member(s) from a previous run
  members      : ${counts.map((c) => `${c.status}=${c._count}`).join(", ")}
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
