/**
 * One-off fixture maker for the Phase 2 manual smoke test (see DEVELOPMENT_PLAN.md Phase 2
 * verification notes). Creates a second organization plus a RECEPTIONIST in the demo org, so the
 * cross-tenant and permission-denied paths can be exercised against a real running server rather
 * than only through supertest.
 *
 * Idempotent. Safe to delete once Phase 3 has a UI that makes this reachable by hand.
 */
import { generateId } from "../src/lib/id";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/lib/prisma";
import { syncOrganizationRoleMatrix, syncPermissionCatalog } from "../src/lib/rbac-catalog";

const PASSWORD = "SmokeTest123!";

async function ensureUser(
  organizationId: string,
  email: string,
  name: string,
  roleId: string,
  branchId: string | null,
) {
  const existing = await prisma.user.findFirst({
    where: { organizationId, email, deletedAt: null },
  });
  if (existing) return existing;

  return prisma.user.create({
    data: {
      id: generateId(),
      organizationId,
      name,
      email,
      passwordHash: await hashPassword(PASSWORD),
      roleId,
      branchId,
    },
  });
}

async function main() {
  await syncPermissionCatalog();

  const orgA = await prisma.organization.findUniqueOrThrow({ where: { slug: "demo-gym" } });
  const rolesA = await syncOrganizationRoleMatrix(orgA.id);

  const orgB = await prisma.organization.upsert({
    where: { slug: "rival-gym" },
    update: {},
    create: {
      id: generateId(),
      name: "Rival Gym",
      slug: "rival-gym",
      email: "owner@rival-gym.test",
    },
  });
  const rolesB = await syncOrganizationRoleMatrix(orgB.id);

  let branchB = await prisma.branch.findFirst({ where: { organizationId: orgB.id } });
  branchB ??= await prisma.branch.create({
    data: { id: generateId(), organizationId: orgB.id, name: "Rival Main Branch" },
  });

  const ownerB = await ensureUser(
    orgB.id,
    "owner@rival-gym.test",
    "Rival Owner",
    rolesB.get("OWNER")!,
    null,
  );
  const receptionistA = await ensureUser(
    orgA.id,
    "reception@demo-gym.test",
    "Demo Receptionist",
    rolesA.get("RECEPTIONIST")!,
    null,
  );

  console.log(
    JSON.stringify(
      {
        password: PASSWORD,
        orgA: { id: orgA.id, slug: orgA.slug },
        orgB: { id: orgB.id, slug: orgB.slug, branchId: branchB.id, ownerId: ownerB.id },
        receptionistA: { id: receptionistA.id, email: receptionistA.email },
        orgB_ownerRoleId: rolesB.get("OWNER"),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
