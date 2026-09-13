/**
 * Phase 7 verification fixtures. Idempotent — safe to re-run before every browser pass.
 *
 *   cd apps/api && pnpm tsx scripts/phase7-fixtures.ts
 *
 * Provides what the attendance checks need and the seed script doesn't:
 *   1. Real RECEPTIONIST and TRAINER logins in the seeded Demo Gym, because "the desk can mark,
 *      the trainer can only read" (Section 4.2) has to be shown with two actual sessions rather
 *      than by reading the permission matrix.
 *   2. One member per membership state — active, expired, frozen, cancelled, not-yet-started and
 *      none at all — because Locked Decision 1.17.1 gives each of them a different override
 *      reason, and a single member can only be in one state at a time.
 *   3. A second branch, so "attendance is stamped where it happened, not where the member is
 *      registered" (1.17.3) can be shown rather than asserted.
 *
 * Terms are anchored on the *gym's* today, not UTC's. Those are different dates for the hours
 * either side of UTC midnight, and a fixture that used `todayUtc()` would hand the harness a
 * member whose term ended "today" but reads as expired (1.17.4).
 *
 * Everything here is namespaced — members on `+9195555…`, the plan named `P7 …`, the branch
 * `P7 Bandra` — so cleanup is precise and real data is never touched.
 */
import { generateId } from "../src/lib/id";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/lib/prisma";
import { syncOrganizationRoleMatrix, syncPermissionCatalog } from "../src/lib/rbac-catalog";
import { addDays, formatCalendarDate, localCalendarDate, safeTimeZone } from "../src/utils/dates";

const ORG_SLUG = "demo-gym";
const PASSWORD = "ChangeMe123!";

const STAFF = [
  { email: "reception@demo-gym.test", name: "Demo Receptionist", role: "RECEPTIONIST", branchScoped: true },
  { email: "trainer@demo-gym.test", name: "Demo Trainer", role: "TRAINER", branchScoped: true },
] as const;

/** Namespaces owned by Phase 7's fixtures and harness. */
export const MEMBER_PHONE_PREFIX = "+9195555";
export const PLAN_NAME_PREFIX = "P7 ";
export const SECOND_BRANCH_NAME = "P7 Bandra";

const PLAN = { name: `${PLAN_NAME_PREFIX}Gold`, price: 1200, durationDays: 30 };

type Term =
  | { kind: "none" }
  | {
      kind: "term";
      status: "ACTIVE" | "EXPIRED" | "FROZEN" | "CANCELLED";
      startOffset: number;
      endOffset: number;
    };

const SCENARIO_MEMBERS: {
  key: string;
  firstName: string;
  lastName: string;
  term: Term;
  /** Registered at the second branch, to prove attendance stamps where the check-in happened. */
  atSecondBranch?: boolean;
}[] = [
  {
    key: "active",
    firstName: "Aarav",
    lastName: "Active",
    term: { kind: "term", status: "ACTIVE", startOffset: -5, endOffset: 24 },
  },
  {
    key: "expired",
    firstName: "Esha",
    lastName: "Expired",
    term: { kind: "term", status: "EXPIRED", startOffset: -60, endOffset: -30 },
  },
  {
    key: "frozen",
    firstName: "Farhan",
    lastName: "Frozen",
    term: { kind: "term", status: "FROZEN", startOffset: -10, endOffset: 19 },
  },
  { key: "none", firstName: "Nisha", lastName: "Nomembership", term: { kind: "none" } },
  {
    key: "cancelled",
    firstName: "Kabir",
    lastName: "Cancelled",
    term: { kind: "term", status: "CANCELLED", startOffset: -10, endOffset: 19 },
  },
  {
    key: "upcoming",
    firstName: "Uma",
    lastName: "Upcoming",
    term: { kind: "term", status: "ACTIVE", startOffset: 7, endOffset: 36 },
  },
  {
    key: "duplicate",
    firstName: "Divya",
    lastName: "Duplicate",
    term: { kind: "term", status: "ACTIVE", startOffset: -3, endOffset: 26 },
  },
  {
    key: "visitor",
    firstName: "Vikram",
    lastName: "Visitor",
    term: { kind: "term", status: "ACTIVE", startOffset: -3, endOffset: 26 },
    atSecondBranch: true,
  },
];

async function main() {
  const organization = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!organization) {
    throw new Error(`No "${ORG_SLUG}" organization. Run \`pnpm prisma db seed\` first.`);
  }

  const branch = await prisma.branch.findFirst({
    where: { organizationId: organization.id, name: { not: SECOND_BRANCH_NAME } },
    orderBy: { createdAt: "asc" },
  });
  if (!branch) {
    throw new Error("Demo Gym has no branch. Run the seed script first.");
  }

  const timeZone = safeTimeZone(organization.timezone);
  const gymToday = localCalendarDate(new Date(), timeZone);

  await syncPermissionCatalog();
  const roleIdByName = await syncOrganizationRoleMatrix(organization.id);

  const secondBranch = await prisma.branch.upsert({
    where: { id: (await findSecondBranchId(organization.id)) ?? generateId() },
    update: { status: "ACTIVE" },
    create: {
      id: generateId(),
      organizationId: organization.id,
      name: SECOND_BRANCH_NAME,
      address: "Linking Road",
    },
  });

  const staffIds: string[] = [];
  for (const person of STAFF) {
    const roleId = roleIdByName.get(person.role)!;
    const existing = await prisma.user.findFirst({
      where: { organizationId: organization.id, email: person.email, deletedAt: null },
    });

    // Reset each run so a half-finished earlier pass can't make an RBAC check fail for the wrong
    // reason. The role matrix sync above also re-grants Phase 7's new `attendance.view` key.
    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash: await hashPassword(PASSWORD),
            roleId,
            branchId: person.branchScoped ? branch.id : null,
            status: "ACTIVE",
          },
        })
      : await prisma.user.create({
          data: {
            id: generateId(),
            organizationId: organization.id,
            name: person.name,
            email: person.email,
            passwordHash: await hashPassword(PASSWORD),
            roleId,
            branchId: person.branchScoped ? branch.id : null,
          },
        });
    staffIds.push(`${person.role} ${person.email} (${user.id})`);
  }

  // Teardown order follows the foreign keys: attendance hangs off members and memberships.
  const scopedMembers = await prisma.member.findMany({
    where: { organizationId: organization.id, phone: { startsWith: MEMBER_PHONE_PREFIX } },
    select: { id: true },
  });
  const memberIds = scopedMembers.map((m) => m.id);

  const removedAttendance = await prisma.attendance.deleteMany({
    where: { organizationId: organization.id, memberId: { in: memberIds } },
  });
  const removedMemberships = await prisma.membership.deleteMany({
    where: {
      organizationId: organization.id,
      OR: [
        { memberId: { in: memberIds } },
        { plan: { name: { startsWith: PLAN_NAME_PREFIX } } },
      ],
    },
  });
  const removedMembers = await prisma.member.deleteMany({
    where: { organizationId: organization.id, phone: { startsWith: MEMBER_PHONE_PREFIX } },
  });
  const removedPlans = await prisma.membershipPlan.deleteMany({
    where: { organizationId: organization.id, name: { startsWith: PLAN_NAME_PREFIX } },
  });

  const plan = await prisma.membershipPlan.create({
    data: {
      id: generateId(),
      organizationId: organization.id,
      name: PLAN.name,
      price: PLAN.price,
      durationDays: PLAN.durationDays,
    },
  });

  const summary: string[] = [];
  for (const [index, person] of SCENARIO_MEMBERS.entries()) {
    const member = await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: organization.id,
        branchId: person.atSecondBranch ? secondBranch.id : branch.id,
        firstName: person.firstName,
        lastName: person.lastName,
        phone: `${MEMBER_PHONE_PREFIX}${index.toString().padStart(5, "0")}`,
        email: `${person.firstName.toLowerCase()}.p7@demo-gym.test`,
      },
    });

    let note = "no membership";
    if (person.term.kind === "term") {
      const { status, startOffset, endOffset } = person.term;
      const startDate = addDays(gymToday, startOffset);
      const endDate = addDays(gymToday, endOffset);

      await prisma.membership.create({
        data: {
          id: generateId(),
          organizationId: organization.id,
          branchId: member.branchId,
          memberId: member.id,
          planId: plan.id,
          priceAtPurchase: PLAN.price,
          durationDaysAtPurchase: PLAN.durationDays,
          startDate,
          endDate,
          status,
          frozenAt: status === "FROZEN" ? new Date() : null,
        },
      });
      note = `${status} ${formatCalendarDate(startDate)} → ${formatCalendarDate(endDate)}`;
    }

    summary.push(
      `${person.firstName} ${person.lastName} (${member.phone}) — ${note}${
        person.atSecondBranch ? ` @ ${SECOND_BRANCH_NAME}` : ""
      }`,
    );
  }

  console.log(`
Phase 7 fixtures ready
  organization : ${organization.name} (${organization.id})
  timezone     : ${timeZone} — gym today is ${formatCalendarDate(gymToday)} (UTC now ${new Date().toISOString()})
  branch       : ${branch.name} (${branch.id})
  branch 2     : ${secondBranch.name} (${secondBranch.id})
  staff        : ${staffIds.join("\n                 ")}
  password     : ${PASSWORD}
  cleaned up   : ${removedAttendance.count} check-in(s), ${removedMemberships.count} membership(s), ${removedMembers.count} member(s), ${removedPlans.count} plan(s)
  plan         : ${plan.name} — ${PLAN.price} / ${PLAN.durationDays}d (${plan.id})
  members      :
                 ${summary.join("\n                 ")}
`);
}

async function findSecondBranchId(organizationId: string): Promise<string | null> {
  const existing = await prisma.branch.findFirst({
    where: { organizationId, name: SECOND_BRANCH_NAME },
    select: { id: true },
  });
  return existing?.id ?? null;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
