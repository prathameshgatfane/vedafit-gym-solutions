import { withGeneratedId, type TransactionClient } from "../../lib/prisma";

/** Section 10.15 platform events. PLAN_ENTITLEMENTS_CHANGED waits for plan CRUD. */
export const PLATFORM_AUDIT_ACTION = {
  ORG_SIGNUP: "ORG_SIGNUP",
  ORG_PROVISIONED: "ORG_PROVISIONED",
  ORG_SUSPENDED: "ORG_SUSPENDED",
  ORG_ACTIVATED: "ORG_ACTIVATED",
  SUBSCRIPTION_CHANGED: "SUBSCRIPTION_CHANGED",
  PLAN_CHANGED: "PLAN_CHANGED",
} as const;

export type PlatformAuditAction =
  (typeof PLATFORM_AUDIT_ACTION)[keyof typeof PLATFORM_AUDIT_ACTION];

export interface WritePlatformAuditInput {
  /** Null for public signup (10.7). Never taken from the request body. */
  platformUserId: string | null;
  /** Target/resource id — not a tenant authorization claim. */
  organizationId: string | null;
  entityType: string;
  entityId: string;
  action: PlatformAuditAction;
  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
}

export async function writePlatformAuditLog(
  tx: TransactionClient,
  input: WritePlatformAuditInput,
): Promise<void> {
  await tx.platformAuditLog.create({
    data: withGeneratedId({
      platformUserId: input.platformUserId,
      organizationId: input.organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      beforeJson: input.beforeJson ?? undefined,
      afterJson: input.afterJson ?? undefined,
    }),
  });
}

export function publicOrgAuditPayload(org: {
  id: string;
  slug: string;
  status: string;
  ownerEmail: string;
  subscription: { planCode: string; status: string };
}) {
  return {
    organization: { id: org.id, slug: org.slug, status: org.status },
    owner: { email: org.ownerEmail },
    subscription: org.subscription,
  };
}
