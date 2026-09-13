/**
 * Phase 1 seed script — docs/architecture/DEVELOPMENT_PLAN.md Locked Decision 1.7 + Section 4.
 *
 * Gym bootstrap for Demo Gym goes through `provisionOrganization` (Phase 15.3) when the slug
 * does not exist yet. Re-runs skip that path so existing Demo Gym + Alice/Bob fixtures are not
 * rewritten. Platform operator seed stays separate (Phase 15.1 — not a gym User).
 *
 * Run with: pnpm --filter api prisma:seed  (or `prisma db seed`)
 */
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";
import { generateId } from "../src/lib/id";
import { logger } from "../src/lib/logger";
import { ROLE_MATRIX, syncOrganizationRoleMatrix, syncPermissionCatalog } from "../src/lib/rbac-catalog";
import { ensureDefaultTemplates } from "../src/services/notification/templates";
import { provisionOrganization } from "../src/modules/organizations/organization-provisioning.service";
import {
  SAAS_PLAN_CODE,
  backfillMissingOrganizationSubscriptions,
  ensureOrganizationSubscription,
  syncSaasPlanCatalog,
} from "../src/modules/saas/saas-catalog";

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
  password: process.env.SEED_OWNER_PASSWORD ?? "ChangeMe123!",
};

const DEFAULT_PLATFORM_OPERATOR = {
  name: "Platform Operator",
  email: "platform@vedafit.test",
  password: process.env.SEED_PLATFORM_PASSWORD ?? "ChangeMe123!",
};

async function seedPlatformOperator() {
  const existing = await prisma.platformUser.findUnique({
    where: { email: DEFAULT_PLATFORM_OPERATOR.email },
  });
  if (existing) {
    logger.info({ platformUserId: existing.id }, "Platform operator already exists, skipping");
    return existing;
  }

  const user = await prisma.platformUser.create({
    data: {
      id: generateId(),
      name: DEFAULT_PLATFORM_OPERATOR.name,
      email: DEFAULT_PLATFORM_OPERATOR.email,
      passwordHash: await hashPassword(DEFAULT_PLATFORM_OPERATOR.password),
    },
  });
  logger.info({ platformUserId: user.id }, "Platform operator created");
  return user;
}

async function seedOwnerIfMissing(organizationId: string, ownerRoleId: string) {
  const existing = await prisma.user.findFirst({
    where: { organizationId, email: DEFAULT_OWNER.email, deletedAt: null },
  });
  if (existing) {
    logger.info({ userId: existing.id }, "OWNER user already exists, skipping");
    return existing;
  }

  const user = await prisma.user.create({
    data: {
      id: generateId(),
      organizationId,
      name: DEFAULT_OWNER.name,
      email: DEFAULT_OWNER.email,
      passwordHash: await hashPassword(DEFAULT_OWNER.password),
      roleId: ownerRoleId,
    },
  });
  logger.info({ userId: user.id }, "OWNER user created on existing Demo Gym");
  return user;
}

async function ensureDemoGym() {
  const existing = await prisma.organization.findUnique({ where: { slug: DEFAULT_ORG.slug } });
  if (!existing) {
    const provisioned = await provisionOrganization({
      organization: DEFAULT_ORG,
      owner: DEFAULT_OWNER,
      branchName: DEFAULT_BRANCH_NAME,
      saas: {
        planCode: SAAS_PLAN_CODE.GROWTH,
        subscriptionStatus: "ACTIVE",
        billingInterval: "YEARLY",
      },
    });
    logger.info(
      { organizationId: provisioned.organization.id, ownerId: provisioned.owner.id },
      "Demo Gym provisioned via provisionOrganization",
    );
    return;
  }

  // Re-run: do not call provisionOrganization (duplicate slug). Refresh catalog/matrix/templates
  // and backfill OWNER if a pre-15.3 gym is missing one. Do not touch Alice/Bob members.
  await syncPermissionCatalog();
  const roleIdByName = await syncOrganizationRoleMatrix(existing.id);
  const ownerRoleId = roleIdByName.get("OWNER");
  if (!ownerRoleId) throw new Error("OWNER role was not seeded — this should never happen");
  await seedOwnerIfMissing(existing.id, ownerRoleId);
  await ensureDefaultTemplates(existing.id);
  const sub = await ensureOrganizationSubscription(existing.id, {
    planCode: SAAS_PLAN_CODE.GROWTH,
    status: "ACTIVE",
    billingInterval: "YEARLY",
  });
  logger.info(
    { organizationId: existing.id, subscriptionId: sub.id, planCode: sub.planCode, created: sub.created },
    "Demo Gym already exists — catalog/matrix refreshed",
  );
}

async function main() {
  await syncPermissionCatalog();
  logger.info({ roles: Object.keys(ROLE_MATRIX) }, "Permission catalog seeded");
  await syncSaasPlanCatalog();
  logger.info({ plans: Object.values(SAAS_PLAN_CODE) }, "SaaS plan catalog seeded");
  await ensureDemoGym();
  const backfilled = await backfillMissingOrganizationSubscriptions();
  if (backfilled > 0) {
    logger.info({ count: backfilled }, "Existing organizations backfilled onto growth");
  }
  await seedPlatformOperator();

  console.log(`
Seed complete.
  Organization: ${DEFAULT_ORG.name} (${DEFAULT_ORG.slug})
  OWNER login:  ${DEFAULT_OWNER.email} / ${DEFAULT_OWNER.password}
  Platform:     ${DEFAULT_PLATFORM_OPERATOR.email} / ${DEFAULT_PLATFORM_OPERATOR.password}
  Try staff:    curl -X POST http://localhost:4000/api/v1/auth/login \\
                  -H 'Content-Type: application/json' \\
                  -d '{"email":"${DEFAULT_OWNER.email}","password":"${DEFAULT_OWNER.password}"}'
  Try platform: curl -X POST http://localhost:4000/api/v1/auth/platform/login \\
                  -H 'Content-Type: application/json' \\
                  -d '{"email":"${DEFAULT_PLATFORM_OPERATOR.email}","password":"${DEFAULT_PLATFORM_OPERATOR.password}"}'
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
