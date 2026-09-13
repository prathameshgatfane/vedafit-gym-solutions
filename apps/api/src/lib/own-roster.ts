import { prisma } from "./prisma";

/**
 * Locked Decision 1.19.1 — the row-level half of `attendance.view` / `members.view` for a
 * trainer. The permission middleware only knows that the key is present; this is the query
 * filter that actually decides which rows come back.
 *
 * `unrestricted` means "do not add a member-id filter" — branch scoping still applies wherever
 * the caller is branch-scoped. `memberIds` is the ACL, and an empty list is a closed door, not
 * a missing filter.
 */
export type OwnRoster = { restricted: false } | { restricted: true; memberIds: string[] };

export interface RosterActor {
  userId: string;
  roleId: string;
}

export async function resolveOwnRoster(actor: RosterActor): Promise<OwnRoster> {
  const granted = await prisma.rolePermission.findMany({
    where: { roleId: actor.roleId },
    select: { permission: { select: { key: true } } },
  });
  const keys = new Set(granted.map((row) => row.permission.key));

  // Desk-and-up hold `attendance.mark`. They see the (branch-scoped) gym, even if someone also
  // attached a TrainerProfile to them. Accountants hold `members.view` but not `attendance.view`,
  // so they fall through to unrestricted as well — Phase 6's read access is not a roster.
  if (!keys.has("attendance.view") || keys.has("attendance.mark")) {
    return { restricted: false };
  }

  const profile = await prisma.trainerProfile.findUnique({
    where: { userId: actor.userId },
    select: { id: true },
  });
  if (!profile) return { restricted: true, memberIds: [] };

  const assignments = await prisma.trainerAssignment.findMany({
    where: { trainerProfileId: profile.id },
    select: { memberId: true },
  });

  return { restricted: true, memberIds: assignments.map((row) => row.memberId) };
}

/** Prisma `id: { in: [] }` is a footgun; callers should use this instead of composing it. */
export function rosterMemberFilter(
  roster: OwnRoster,
): { id: { in: string[] } } | undefined {
  if (!roster.restricted) return undefined;
  return { id: { in: roster.memberIds } };
}

export function rosterAllows(roster: OwnRoster, memberId: string): boolean {
  if (!roster.restricted) return true;
  return roster.memberIds.includes(memberId);
}
