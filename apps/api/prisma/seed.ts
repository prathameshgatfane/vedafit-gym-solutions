/**
 * Phase 1 seed script — docs/architecture/DEVELOPMENT_PLAN.md Locked Decision 1.7 + Section 4.
 *
 * Creates, if they don't already exist:
 *  - One default Organization + Branch (local dev bootstrap — no public signup until Phase 15)
 *  - The full Permission catalog (Section 4.1)
 *  - The default Role -> Permission matrix (Section 4.2), seeded per-organization
 *  - One OWNER User who can log in once Phase 2 ships auth
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

// Section 4.1 — permission catalog. Grows per phase, never shrinks.
const PERMISSION_CATALOG: { key: string; description: string }[] = [
  { key: "organizations.update", description: "Update organization settings" },
  { key: "branches.manage", description: "Create/update/deactivate branches" },
  { key: "users.manage", description: "Create/update/deactivate staff users" },
  { key: "roles.manage", description: "Create/update custom roles and permission assignments" },
  { key: "members.create", description: "Create new members" },
  { key: "members.view", description: "View member records" },
  { key: "members.update", description: "Update member records" },
  { key: "members.archive", description: "Archive/soft-delete members" },
  { key: "membership-plans.manage", description: "Create/update membership plans" },
  { key: "memberships.create", description: "Enroll a member into a plan" },
  { key: "memberships.freeze", description: "Freeze an active membership" },
  { key: "memberships.cancel", description: "Cancel a membership" },
  { key: "memberships.renew", description: "Renew an existing membership" },
  { key: "payments.create", description: "Record a payment" },
  { key: "payments.view", description: "View payment history" },
  { key: "payments.refund", description: "Issue a refund against a payment" },
  { key: "invoices.view", description: "View invoices" },
  { key: "invoices.manage", description: "Create/update invoices" },
  { key: "attendance.mark", description: "Mark member attendance" },
  { key: "attendance.view", description: "View attendance history" },
  { key: "trainers.manage", description: "Manage trainer profiles (Phase 9)" },
  { key: "leads.manage", description: "Manage the leads/CRM pipeline (Phase 10)" },
  { key: "expenses.manage", description: "Record/manage operational expenses (Phase 11)" },
  { key: "reports.view", description: "View reports/dashboard analytics" },
  { key: "settings.manage", description: "Manage organization-level settings" },
  { key: "notifications.manage", description: "Manage notification templates (Phase 12)" },
];

const ALL_KEYS = PERMISSION_CATALOG.map((p) => p.key);
const keysMatching = (...prefixes: string[]) =>
  ALL_KEYS.filter((key) => prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}.`)));

// Section 4.2 — default role -> permission matrix.
const ROLE_MATRIX: Record<string, string[]> = {
  OWNER: ALL_KEYS,
  ADMIN: ALL_KEYS.filter((k) => k !== "organizations.update" && k !== "roles.manage"),
  MANAGER: [
    ...keysMatching("members"),
    "membership-plans.manage",
    ...keysMatching("memberships"),
    "payments.create",
    "payments.view",
    ...keysMatching("attendance"),
    "reports.view",
    "trainers.manage",
    "leads.manage",
  ],
  RECEPTIONIST: [
    "members.create",
    "members.view",
    "members.update",
    "memberships.create",
    "payments.create",
    "attendance.mark",
    "leads.manage",
  ],
  ACCOUNTANT: [...keysMatching("payments", "invoices"), "expenses.manage", "reports.view"],
  TRAINER: ["attendance.view", "members.view"],
};

async function seedPermissionCatalog() {
  for (const permission of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: { id: generateId(), key: permission.key, description: permission.description },
    });
  }
  logger.info({ count: PERMISSION_CATALOG.length }, "Permission catalog seeded");
}

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
  const allPermissions = await prisma.permission.findMany();
  const permissionIdByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

  const roleIdByName = new Map<string, string>();

  for (const [roleName, permissionKeys] of Object.entries(ROLE_MATRIX)) {
    let role = await prisma.role.findUnique({
      where: { organizationId_name: { organizationId, name: roleName } },
    });

    if (!role) {
      role = await prisma.role.create({
        data: { id: generateId(), organizationId, name: roleName },
      });
    }

    // Idempotent: replace this role's permission set with the current matrix definition.
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    const permissionIds = permissionKeys
      .map((key) => permissionIdByKey.get(key))
      .filter((id): id is string => Boolean(id));

    if (permissionIds.length > 0) {
      await prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: role!.id, permissionId })),
      });
    }

    roleIdByName.set(roleName, role.id);
  }

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
  await seedPermissionCatalog();
  const { organization } = await seedOrganizationAndBranch();
  const roleIdByName = await seedRoleMatrix(organization.id);
  const ownerRoleId = roleIdByName.get("OWNER");
  if (!ownerRoleId) throw new Error("OWNER role was not seeded — this should never happen");
  await seedOwnerUser(organization.id, ownerRoleId);

  console.log(`
Seed complete.
  Organization: ${DEFAULT_ORG.name} (${DEFAULT_ORG.slug})
  OWNER login:  ${DEFAULT_OWNER.email} / ${DEFAULT_OWNER.password}
  (Login itself isn't wired up until Phase 2 — these are the credentials that will work then.)
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
