/**
 * Phase 9 verification fixtures. Idempotent — safe to re-run before every browser pass.
 *
 *   cd apps/api && pnpm tsx scripts/phase9-fixtures.ts
 *
 * Sets up the two things the harness has to show rather than trust:
 *
 *   1. A live TrainerProfile on the demo TRAINER, with one member assigned and one not, both
 *      checked in today — so a trainer session's register and the desk's register can be shown
 *      to disagree (Locked Decision 1.19.1).
 *   2. A second TRAINER user with no profile (`coach@demo-gym.test`), so the UI create path has
 *      a candidate and an unprofiled trainer can be shown to see an empty roster, not the gym.
 *
 * Namespaced: members on `+9193333…`. The demo TRAINER's profile is upserted; the coach's
 * profile is deleted if a previous harness run created one, so "create through the form" stays
 * repeatable.
 */
import { generateId } from "../src/lib/id";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/lib/prisma";
import { syncOrganizationRoleMatrix, syncPermissionCatalog } from "../src/lib/rbac-catalog";
import { localCalendarDate, safeTimeZone } from "../src/utils/dates";

const ORG_SLUG = "demo-gym";
const PASSWORD = "ChangeMe123!";

const STAFF = [
  { email: "reception@demo-gym.test", name: "Demo Receptionist", role: "RECEPTIONIST", branchScoped: true },
  { email: "trainer@demo-gym.test", name: "Demo Trainer", role: "TRAINER", branchScoped: true },
  { email: "accounts@demo-gym.test", name: "Demo Accountant", role: "ACCOUNTANT", branchScoped: false },
  { email: "coach@demo-gym.test", name: "Demo Coach", role: "TRAINER", branchScoped: true },
] as const;

export const MEMBER_PHONE_PREFIX = "+9193333";
export const COACH_EMAIL = "coach@demo-gym.test";
export const TRAINER_EMAIL = "trainer@demo-gym.test";

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

  const trainerUser = await prisma.user.findFirstOrThrow({
    where: { organizationId: organization.id, email: TRAINER_EMAIL, deletedAt: null },
  });
  const coachUser = await prisma.user.findFirstOrThrow({
    where: { organizationId: organization.id, email: COACH_EMAIL, deletedAt: null },
  });
  const receptionist = await prisma.user.findFirstOrThrow({
    where: { organizationId: organization.id, email: "reception@demo-gym.test", deletedAt: null },
  });

  const coachProfile = await prisma.trainerProfile.findUnique({
    where: { userId: coachUser.id },
  });
  if (coachProfile) {
    await prisma.trainerAssignment.deleteMany({ where: { trainerProfileId: coachProfile.id } });
    await prisma.trainerProfile.delete({ where: { id: coachProfile.id } });
  }

  const p9Members = await prisma.member.findMany({
    where: { organizationId: organization.id, phone: { startsWith: MEMBER_PHONE_PREFIX } },
    select: { id: true },
  });
  const p9Ids = p9Members.map((row) => row.id);
  if (p9Ids.length > 0) {
    await prisma.trainerAssignment.deleteMany({ where: { memberId: { in: p9Ids } } });
    await prisma.attendance.deleteMany({ where: { memberId: { in: p9Ids } } });
    await prisma.member.deleteMany({ where: { id: { in: p9Ids } } });
  }

  let trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: trainerUser.id },
  });
  if (trainerProfile) {
    await prisma.trainerAssignment.deleteMany({ where: { trainerProfileId: trainerProfile.id } });
    trainerProfile = await prisma.trainerProfile.update({
      where: { id: trainerProfile.id },
      data: { specialization: "Strength", commissionPct: 10.5 },
    });
  } else {
    trainerProfile = await prisma.trainerProfile.create({
      data: {
        id: generateId(),
        organizationId: organization.id,
        userId: trainerUser.id,
        specialization: "Strength",
        commissionPct: 10.5,
      },
    });
  }

  const assigned = await prisma.member.create({
    data: {
      id: generateId(),
      organizationId: organization.id,
      branchId: mainBranch.id,
      firstName: "Kiran",
      lastName: "Assigned",
      phone: `${MEMBER_PHONE_PREFIX}00001`,
    },
  });
  const outsider = await prisma.member.create({
    data: {
      id: generateId(),
      organizationId: organization.id,
      branchId: mainBranch.id,
      firstName: "Zoya",
      lastName: "Outsider",
      phone: `${MEMBER_PHONE_PREFIX}00002`,
    },
  });

  await prisma.trainerAssignment.create({
    data: {
      id: generateId(),
      organizationId: organization.id,
      trainerProfileId: trainerProfile.id,
      memberId: assigned.id,
      assignedByUserId: receptionist.id,
    },
  });

  const timeZone = safeTimeZone(organization.timezone);
  const gymToday = localCalendarDate(new Date(), timeZone);

  for (const member of [assigned, outsider]) {
    await prisma.attendance.create({
      data: {
        id: generateId(),
        organizationId: organization.id,
        branchId: mainBranch.id,
        memberId: member.id,
        attendanceDate: gymToday,
        overrideReason: "NO_MEMBERSHIP",
        markedByUserId: receptionist.id,
      },
    });
  }

  console.log("\nPhase 9 fixtures ready");
  console.log(`  organization : ${organization.name} (${organization.id})`);
  console.log(`  timezone     : ${timeZone}`);
  console.log(`  branch       : ${mainBranch.name} (${mainBranch.id})`);
  console.log(`  trainer      : ${TRAINER_EMAIL} — profile ${trainerProfile.id}, roster = Kiran Assigned`);
  console.log(`  coach        : ${COACH_EMAIL} — no profile (candidate for the form)`);
  console.log(`  members      : Kiran Assigned (on roster, checked in)`);
  console.log(`                 Zoya Outsider  (not on roster, checked in)`);
  console.log(`  password     : ${PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
