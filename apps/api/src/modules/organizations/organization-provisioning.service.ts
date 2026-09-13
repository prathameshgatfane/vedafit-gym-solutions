import { Prisma, type OrganizationSubscriptionStatus, type SaasBillingInterval } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { hashPassword } from "../../lib/password";
import { prisma, withGeneratedId, type TransactionClient } from "../../lib/prisma";
import { syncOrganizationRoleMatrix, syncPermissionCatalog } from "../../lib/rbac-catalog";
import { attachOrganizationSubscription, SAAS_PLAN_CODE, syncSaasPlanCatalog } from "../saas/saas-catalog";
import { ensureDefaultTemplates } from "../../services/notification/templates";

/**
 * Canonical gym bootstrap (15.3) plus a trial/default SaaS subscription (15.5).
 * Signup and Super Admin create reuse this — they must not copy org setup.
 */
export interface ProvisionOrganizationInput {
  organization: {
    name: string;
    slug: string;
    email: string;
    phone?: string;
    timezone?: string;
  };
  owner: {
    name: string;
    email: string;
    password: string;
  };
  branchName?: string;
  /** Server-only. Public signup must not accept plan/status from the client. */
  saas?: {
    planCode?: string;
    subscriptionStatus?: OrganizationSubscriptionStatus;
    billingInterval?: SaasBillingInterval;
  };
}

export interface ProvisionedOrganization {
  organization: {
    id: string;
    name: string;
    slug: string;
    email: string;
    phone: string | null;
    status: string;
    timezone: string;
  };
  branch: { id: string; name: string };
  owner: { id: string; name: string; email: string; roleId: string };
  roleIdByName: Map<string, string>;
  subscription: { id: string; planCode: string; status: string };
}

const DEFAULT_BRANCH_NAME = "Main Branch";

function isSlugConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    Array.isArray(error.meta?.target) &&
    (error.meta.target as string[]).includes("slug")
  );
}

/**
 * Inner write path. Used by `provisionOrganization` and by later slices that must attach more
 * rows (e.g. a trial subscription) in the **same** transaction.
 */
export async function provisionOrganizationInTransaction(
  tx: TransactionClient,
  input: ProvisionOrganizationInput,
  passwordHash: string,
): Promise<ProvisionedOrganization> {
  const slug = input.organization.slug.trim();
  const ownerEmail = input.owner.email.trim().toLowerCase();
  const branchName = input.branchName?.trim() || DEFAULT_BRANCH_NAME;

  const existing = await tx.organization.findUnique({ where: { slug } });
  if (existing) {
    throw AppError.conflict(
      ErrorCode.DUPLICATE_ORGANIZATION_SLUG,
      `An organization with slug "${slug}" already exists`,
    );
  }

  let organization;
  try {
    organization = await tx.organization.create({
      data: withGeneratedId({
        name: input.organization.name.trim(),
        slug,
        email: input.organization.email.trim(),
        ...(input.organization.phone?.trim()
          ? { phone: input.organization.phone.trim() }
          : {}),
        ...(input.organization.timezone
          ? { timezone: input.organization.timezone }
          : {}),
      }),
    });
  } catch (error) {
    if (isSlugConflict(error)) {
      throw AppError.conflict(
        ErrorCode.DUPLICATE_ORGANIZATION_SLUG,
        `An organization with slug "${slug}" already exists`,
      );
    }
    throw error;
  }

  const branch = await tx.branch.create({
    data: withGeneratedId({
      organizationId: organization.id,
      name: branchName,
    }),
  });

  const roleIdByName = await syncOrganizationRoleMatrix(organization.id, tx);
  const ownerRoleId = roleIdByName.get("OWNER");
  if (!ownerRoleId) {
    throw new Error("OWNER role was not created — ROLE_MATRIX is missing OWNER");
  }

  const owner = await tx.user.create({
    data: withGeneratedId({
      organizationId: organization.id,
      name: input.owner.name.trim(),
      email: ownerEmail,
      passwordHash,
      roleId: ownerRoleId,
      branchId: null,
    }),
  });

  await ensureDefaultTemplates(organization.id, tx);

  const saas = input.saas ?? {};
  const subscription = await attachOrganizationSubscription(tx, {
    organizationId: organization.id,
    planCode: saas.planCode ?? SAAS_PLAN_CODE.TRIAL,
    status: saas.subscriptionStatus ?? "TRIAL",
    billingInterval: saas.billingInterval,
  });

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      email: organization.email,
      phone: organization.phone,
      status: organization.status,
      timezone: organization.timezone,
    },
    branch: { id: branch.id, name: branch.name },
    owner: { id: owner.id, name: owner.name, email: owner.email, roleId: owner.roleId },
    roleIdByName,
    subscription,
  };
}

/**
 * Canonical gym bootstrap. Permission + SaaS catalogs are global and synced before the tenant
 * transaction so concurrent provisions do not serialize on those tables.
 */
export async function provisionOrganization(
  input: ProvisionOrganizationInput,
  options?: {
    /** Runs in the same tenant transaction after bootstrap — used by 15.11 audit writes. */
    afterProvision?: (
      tx: TransactionClient,
      result: ProvisionedOrganization,
    ) => Promise<void>;
  },
): Promise<ProvisionedOrganization> {
  await syncPermissionCatalog();
  await syncSaasPlanCatalog();
  const passwordHash = await hashPassword(input.owner.password);

  return prisma.$transaction(async (tx) => {
    const result = await provisionOrganizationInTransaction(tx, input, passwordHash);
    await options?.afterProvision?.(tx, result);
    return result;
  });
}
