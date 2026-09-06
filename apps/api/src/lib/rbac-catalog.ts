import { prisma } from "./prisma";
import { generateId } from "./id";

/**
 * The permission catalog and default role matrix from DEVELOPMENT_PLAN.md Section 4.
 *
 * Single source of truth, shared by the seed script and the test helpers. When these lived only
 * inside prisma/seed.ts, any test that needed a role with real permissions had to restate the
 * matrix, and a permission-denied test could pass against a matrix that no longer matched the
 * seeded one.
 *
 * Grows per phase, never shrinks (Section 4.1).
 */
export const PERMISSION_CATALOG: { key: string; description: string }[] = [
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

/** Section 4.2 — default role → permission matrix, seeded per organization. */
export const ROLE_MATRIX: Record<string, string[]> = {
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

export type DefaultRoleName = keyof typeof ROLE_MATRIX;

/** Upserts the global permission catalog. Idempotent. */
export async function syncPermissionCatalog(): Promise<number> {
  for (const permission of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: { id: generateId(), key: permission.key, description: permission.description },
    });
  }
  return PERMISSION_CATALOG.length;
}

/**
 * Creates (or refreshes) the six default roles for one organization and points each at the
 * permission set the matrix says it should have. Idempotent: an existing role keeps its id and
 * has its permission set replaced with the current matrix.
 */
export async function syncOrganizationRoleMatrix(
  organizationId: string,
): Promise<Map<string, string>> {
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

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });

    const permissionIds = permissionKeys
      .map((key) => permissionIdByKey.get(key))
      .filter((id): id is string => Boolean(id));

    if (permissionIds.length > 0) {
      await prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
      });
    }

    roleIdByName.set(roleName, role.id);
  }

  return roleIdByName;
}
