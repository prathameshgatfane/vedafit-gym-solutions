import { Prisma } from "@prisma/client";
import { prisma, withGeneratedId, type TransactionClient } from "../../lib/prisma";
import { DEFAULT_SMS_TEMPLATES } from "./defaults";

export async function ensureDefaultTemplates(
  organizationId: string,
  db: TransactionClient = prisma,
): Promise<void> {
  const now = new Date();
  await db.notificationTemplate.createMany({
    data: DEFAULT_SMS_TEMPLATES.map((template) =>
      withGeneratedId({
        organizationId,
        event: template.event,
        channel: "SMS" as const,
        body: template.body,
        createdAt: now,
        updatedAt: now,
      }),
    ),
    skipDuplicates: true,
  });
}

export async function ensureDefaultTemplatesForAllOrgs(): Promise<void> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  for (const org of orgs) {
    await ensureDefaultTemplates(org.id);
  }
}

export function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
