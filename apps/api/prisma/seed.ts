/**
 * Phase 1 seed script — docs/architecture/DEVELOPMENT_PLAN.md Locked Decision 1.7 + Section 4.
 *
 * Creates, if they don't already exist:
 *  - One default Organization + Branch (local dev bootstrap — no public signup until Phase 15)
 *  - The full Permission catalog (Section 4.1)
 *  - The default Role -> Permission matrix (Section 4.2), seeded per-organization
 *  - One OWNER User who can log in via POST /api/v1/auth/login
 *
 * Idempotent: safe to re-run. Existing rows (matched by slug/key/name) are left alone rather
 * than duplicated.
 *
 * Run with: pnpm --filter api prisma:seed  (or `prisma db seed`)
 */
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";
import { generateId } from "../src/lib/id";
import { logger } from "../src/lib/logger";
import {
  ROLE_MATRIX,
  syncOrganizationRoleMatrix,
  syncPermissionCatalog,
} from "../src/lib/rbac-catalog";

const DEFAULT_ORG = {
  name: "Demo Gym",
  slug: "demo-gym",
  email: "owner@demo-gym.test",
  phone: "+91 9000000000",
};

const DEFAULT_BRANCH_NAME = "Main Branch";

const DEFAULT_OWNER = {
  name: "Demo Owner",
  email: "owner@demo-gym.test",
  // Overridable via env for anyone re-running this against a shared environment.
  password: process.env.SEED_OWNER_PASSWORD ?? "ChangeMe123!",
};

async function seedOrganizationAndBranch() {
  const organization = await prisma.organization.upsert({
    where: { slug: DEFAULT_ORG.slug },
    update: {},
    create: {
      id: generateId(),
      name: DEFAULT_ORG.name,
      slug: DEFAULT_ORG.slug,
      email: DEFAULT_ORG.email,
      phone: DEFAULT_ORG.phone,
    },
  });

  let branch = await prisma.branch.findFirst({
    where: { organizationId: organization.id, name: DEFAULT_BRANCH_NAME },
  });
  if (!branch) {
    branch = await prisma.branch.create({
      data: { id: generateId(), organizationId: organization.id, name: DEFAULT_BRANCH_NAME },
    });
  }

  logger.info({ organizationId: organization.id, branchId: branch.id }, "Organization + branch seeded");
  return { organization, branch };
}

async function seedRoleMatrix(organizationId: string) {
  const roleIdByName = await syncOrganizationRoleMatrix(organizationId);
  logger.info(
    { organizationId, roles: Object.keys(ROLE_MATRIX) },
    "Role -> permission matrix seeded",
  );
  return roleIdByName;
}

async function seedOwnerUser(organizationId: string, ownerRoleId: string) {
  const existing = await prisma.user.findFirst({
    where: { organizationId, email: DEFAULT_OWNER.email, deletedAt: null },
  });
  if (existing) {
    logger.info({ userId: existing.id }, "OWNER user already exists, skipping");
    return existing;
  }

  const passwordHash = await hashPassword(DEFAULT_OWNER.password);
  const user = await prisma.user.create({
    data: {
      id: generateId(),
      organizationId,
      name: DEFAULT_OWNER.name,
      email: DEFAULT_OWNER.email,
      passwordHash,
      roleId: ownerRoleId,
    },
  });

  logger.info(
    { userId: user.id, email: DEFAULT_OWNER.email },
    "OWNER user created — see console output for the seed password",
  );
  return user;
}

async function main() {
  const permissionCount = await syncPermissionCatalog();
  logger.info({ count: permissionCount }, "Permission catalog seeded");
  const { organization } = await seedOrganizationAndBranch();
  const roleIdByName = await seedRoleMatrix(organization.id);
  const ownerRoleId = roleIdByName.get("OWNER");
  if (!ownerRoleId) throw new Error("OWNER role was not seeded — this should never happen");
  await seedOwnerUser(organization.id, ownerRoleId);

  console.log(`
Seed complete.
  Organization: ${DEFAULT_ORG.name} (${DEFAULT_ORG.slug})
  OWNER login:  ${DEFAULT_OWNER.email} / ${DEFAULT_OWNER.password}
  Try it:       curl -X POST http://localhost:4000/api/v1/auth/login \\
                  -H 'Content-Type: application/json' \\
                  -d '{"email":"${DEFAULT_OWNER.email}","password":"${DEFAULT_OWNER.password}"}'
`);
}

main()
  .catch((err) => {
    logger.error({ err }, "Seed failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
