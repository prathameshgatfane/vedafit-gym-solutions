/**
 * Phase 10 verification fixtures. Idempotent — safe to re-run before every browser pass.
 *
 *   cd apps/api && pnpm tsx scripts/phase10-fixtures.ts
 *
 * Puts one lead in each pipeline status so the harness can show the graph (1.20.1) rather than
 * invent it: a NEW to convert, a CONTACTED to skip-forward, a TRIAL_SCHEDULED that can only go
 * to LOST, a LOST that reopens only to CONTACTED. Namespaced on `+9192222…`. Also syncs the
 * permission catalog so a receptionist seeded before Phase 10 actually holds `leads.manage`.
 */
import { generateId } from "../src/lib/id";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/lib/prisma";
import { syncOrganizationRoleMatrix, syncPermissionCatalog } from "../src/lib/rbac-catalog";

const ORG_SLUG = "demo-gym";
const PASSWORD = "ChangeMe123!";

const STAFF = [
  { email: "reception@demo-gym.test", name: "Demo Receptionist", role: "RECEPTIONIST", branchScoped: true },
  { email: "trainer@demo-gym.test", name: "Demo Trainer", role: "TRAINER", branchScoped: true },
  { email: "accounts@demo-gym.test", name: "Demo Accountant", role: "ACCOUNTANT", branchScoped: false },
] as const;

export const LEAD_PHONE_PREFIX = "+9192222";

async function main() {
  const organization = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!organization) {
    throw new Error(`No "${ORG_SLUG}" organization. Run \`pnpm prisma db seed\` first.`);
  }

  const mainBranch = await prisma.branch.findFirst({
    where: { organizationId: organization.id },
    orderBy: { createdAt: "asc" },
  });
  if (!mainBranch) {
    throw new Error("Demo Gym has no branch. Run the seed script first.");
  }

  await syncPermissionCatalog();
  const roleIdByName = await syncOrganizationRoleMatrix(organization.id);

  for (const person of STAFF) {
    const roleId = roleIdByName.get(person.role)!;
    const existing = await prisma.user.findFirst({
      where: { organizationId: organization.id, email: person.email, deletedAt: null },
    });
    const data = {
      passwordHash: await hashPassword(PASSWORD),
      roleId,
      branchId: person.branchScoped ? mainBranch.id : null,
      name: person.name,
      status: "ACTIVE" as const,
    };
    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data });
    } else {
      await prisma.user.create({
        data: {
          id: generateId(),
          organizationId: organization.id,
          email: person.email,
          ...data,
        },
      });
    }
  }

  const p10Members = await prisma.member.findMany({
    where: { organizationId: organization.id, phone: { startsWith: LEAD_PHONE_PREFIX } },
    select: { id: true },
  });
  const p10Ids = p10Members.map((row) => row.id);

  await prisma.lead.deleteMany({
    where: {
      organizationId: organization.id,
      OR: [
        { phone: { startsWith: LEAD_PHONE_PREFIX } },
        ...(p10Ids.length > 0 ? [{ convertedMemberId: { in: p10Ids } }] : []),
      ],
    },
  });
  if (p10Ids.length > 0) {
    await prisma.member.deleteMany({ where: { id: { in: p10Ids } } });
  }

  const receptionist = await prisma.user.findFirstOrThrow({
    where: { organizationId: organization.id, email: "reception@demo-gym.test", deletedAt: null },
  });

  const seeds: {
    name: string;
    phone: string;
    status: "NEW" | "CONTACTED" | "TRIAL_SCHEDULED" | "LOST";
    source: string;
    assignedToUserId?: string;
  }[] = [
    { name: "Priya New", phone: `${LEAD_PHONE_PREFIX}00001`, status: "NEW", source: "walk-in" },
    {
      name: "Aarav Contacted",
      phone: `${LEAD_PHONE_PREFIX}00002`,
      status: "CONTACTED",
      source: "instagram",
      assignedToUserId: receptionist.id,
    },
    {
      name: "Meera Trial",
      phone: `${LEAD_PHONE_PREFIX}00003`,
      status: "TRIAL_SCHEDULED",
      source: "referral",
    },
    { name: "Vikram Lost", phone: `${LEAD_PHONE_PREFIX}00004`, status: "LOST", source: "walk-in" },
    { name: "Zoya Convert", phone: `${LEAD_PHONE_PREFIX}00009`, status: "NEW", source: "instagram" },
  ];

  for (const seed of seeds) {
    await prisma.lead.create({
      data: {
        id: generateId(),
        organizationId: organization.id,
        branchId: mainBranch.id,
        name: seed.name,
        phone: seed.phone,
        source: seed.source,
        status: seed.status,
        assignedToUserId: seed.assignedToUserId ?? null,
      },
    });
  }

  console.log(
    `Phase 10 fixtures ready: ${seeds.length} leads on ${LEAD_PHONE_PREFIX}… at ${mainBranch.name}.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
