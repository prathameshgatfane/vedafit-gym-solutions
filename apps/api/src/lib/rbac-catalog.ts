import { prisma, type TransactionClient } from "./prisma";
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
  // `.view` counterparts added in Phase 5 — see DEVELOPMENT_PLAN.md Section 9. Section 4.1 listed
  // only the write permissions, which left no way to *read* a plan or a membership; a
  // RECEPTIONIST holding `memberships.create` couldn't even list the plans to pick one.
  { key: "membership-plans.view", description: "View membership plans" },
  { key: "membership-plans.manage", description: "Create/update membership plans" },
  { key: "memberships.view", description: "View membership records" },
  { key: "memberships.create", description: "Enroll a member into a plan" },
  { key: "memberships.freeze", description: "Freeze/unfreeze a membership" },
  { key: "memberships.cancel", description: "Cancel a membership or switch plans mid-term" },
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
    ...keysMatching("membership-plans"),
    ...keysMatching("memberships"),
    "payments.create",
    "payments.view",
    // Added in Phase 6: selling a membership raises an invoice, so a manager who cannot see or
    // raise one cannot finish the job they already have permission to start. `payments.refund`
    // stays out on purpose — Locked Decision 1.16.1 keeps "runs the gym" and "returns money"
    // apart, and it is the boundary that stops a mid-term plan change from moving money.
    "invoices.view",
    "invoices.manage",
    ...keysMatching("attendance"),
    "reports.view",
    "trainers.manage",
    "leads.manage",
  ],
  RECEPTIONIST: [
    "members.create",
    "members.view",
    "members.update",
    "membership-plans.view",
    "memberships.view",
    "memberships.create",
    // Added in Phase 5: under Locked Decision 1.15.3 a renewal *is* a new membership row, so a
    // front desk that can sell a first term but not a second one is an arbitrary line — and one
    // staff would route around by creating a fresh membership instead. Freeze and cancel stay
    // manager-and-up, since those give time or money away.
    "memberships.renew",
    "payments.create",
    // Added in Phase 6, same shape of gap as the Phase 5 `.view` additions: a front desk that can
    // take a payment but can't see the invoice it pays down, or what the member already paid,
    // has no way to answer "how much do I owe?" — the most common question at a gym counter.
    // Read and record only; `payments.refund` and `invoices.manage` stay above them.
    "payments.view",
    "invoices.view",
    "attendance.mark",
    // Added in Phase 7, the same shape of gap again: the daily register is the front desk's own
    // screen, and a role that can mark attendance but not read it can't answer "has she already
    // come in today?" — nor see that the button worked. Marking without reading is not a coherent
    // job. Read stays scoped to their branch by the usual rule (1.17.3).
    "attendance.view",
    "leads.manage",
  ],
  ACCOUNTANT: [
    ...keysMatching("payments", "invoices"),
    // Read-only: a payment is meaningless without the membership term it paid for.
    "membership-plans.view",
    "memberships.view",
    // Added in Phase 6: an invoice is raised *against a member*, so the one role whose job is
    // raising invoices has to be able to look one up. Read-only — creating and editing members
    // stays with the front desk.
    "members.view",
    "expenses.manage",
    "reports.view",
  ],
  TRAINER: ["attendance.view", "members.view"],
};

export type DefaultRoleName = keyof typeof ROLE_MATRIX;

/** Upserts the global permission catalog. Idempotent. */
export async function syncPermissionCatalog(
  db: TransactionClient = prisma,
): Promise<number> {
  for (const permission of PERMISSION_CATALOG) {
    await db.permission.upsert({
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
  db: TransactionClient = prisma,
): Promise<Map<string, string>> {
  const allPermissions = await db.permission.findMany();
  const permissionIdByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

  const roleIdByName = new Map<string, string>();

  for (const [roleName, permissionKeys] of Object.entries(ROLE_MATRIX)) {
    let role = await db.role.findUnique({
      where: { organizationId_name: { organizationId, name: roleName } },
    });

    if (!role) {
      role = await db.role.create({
        data: { id: generateId(), organizationId, name: roleName },
      });
    }

    await db.rolePermission.deleteMany({ where: { roleId: role.id } });

    const permissionIds = permissionKeys
      .map((key) => permissionIdByKey.get(key))
      .filter((id): id is string => Boolean(id));

    if (permissionIds.length > 0) {
      await db.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
      });
    }

    roleIdByName.set(roleName, role.id);
  }

  return roleIdByName;
}
