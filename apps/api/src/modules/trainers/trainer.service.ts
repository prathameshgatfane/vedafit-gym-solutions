import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { prisma, withGeneratedId } from "../../lib/prisma";
import { buildPaginationMeta, paginationSkipTake } from "../../utils/pagination";
import type {
  AssignMemberInput,
  CreateTrainerProfileInput,
  ListTrainersQuery,
  UpdateTrainerProfileInput,
} from "./trainer.schema";

export interface TrainerScope {
  organizationId: string;
  branchId: string | null;
  userId: string;
}

const profileInclude = {
  user: { select: { id: true, name: true, email: true, status: true, branchId: true } },
  assignments: {
    include: {
      member: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          status: true,
          branchId: true,
        },
      },
    },
    orderBy: { assignedAt: "desc" as const },
  },
} satisfies Prisma.TrainerProfileInclude;

type ProfileRow = Prisma.TrainerProfileGetPayload<{ include: typeof profileInclude }>;

export interface TrainerProfileResponse {
  id: string;
  organizationId: string;
  userId: string;
  specialization: string | null;
  commissionPct: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: ProfileRow["user"];
  assignments: {
    id: string;
    memberId: string;
    assignedAt: Date;
    member: ProfileRow["assignments"][number]["member"];
  }[];
}

function toResponse(row: ProfileRow): TrainerProfileResponse {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    specialization: row.specialization,
    commissionPct: row.commissionPct === null ? null : row.commissionPct.toFixed(2),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    user: row.user,
    assignments: row.assignments.map((assignment) => ({
      id: assignment.id,
      memberId: assignment.memberId,
      assignedAt: assignment.assignedAt,
      member: assignment.member,
    })),
  };
}

function commissionDecimal(value: number | null | undefined): Prisma.Decimal | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Prisma.Decimal(value.toFixed(2));
}

async function permissionKeysFor(roleId: string): Promise<Set<string>> {
  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permission: { select: { key: true } } },
  });
  return new Set(rows.map((row) => row.permission.key));
}

/**
 * Live user, same org, holds `attendance.view`, does not hold `trainers.manage` (1.19.3).
 */
async function assertUserIsEligible(
  organizationId: string,
  userId: string,
): Promise<{ id: string; roleId: string; status: string; deletedAt: Date | null }> {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { id: true, roleId: true, status: true, deletedAt: true, name: true },
  });
  if (!user || user.deletedAt) {
    throw AppError.notFound(ErrorCode.USER_NOT_FOUND, `User "${userId}" not found`);
  }
  if (user.status !== "ACTIVE") {
    throw AppError.conflict(
      ErrorCode.USER_NOT_ELIGIBLE_TRAINER,
      `${user.name} is not an active staff member`,
    );
  }

  const keys = await permissionKeysFor(user.roleId);
  if (!keys.has("attendance.view") || keys.has("trainers.manage")) {
    throw AppError.conflict(
      ErrorCode.USER_NOT_ELIGIBLE_TRAINER,
      `${user.name} cannot be a trainer — pick a staff member whose role is the trainer matrix`,
    );
  }

  return user;
}

async function findProfileOrThrow(scope: TrainerScope, trainerId: string): Promise<ProfileRow> {
  const profile = await prisma.trainerProfile.findFirst({
    where: { id: trainerId, organizationId: scope.organizationId },
    include: profileInclude,
  });
  if (!profile) {
    throw AppError.notFound(
      ErrorCode.TRAINER_PROFILE_NOT_FOUND,
      `Trainer "${trainerId}" not found`,
    );
  }
  return profile;
}

export const trainerService = {
  async list(scope: TrainerScope, query: ListTrainersQuery) {
    const search = query.search?.trim();
    const where: Prisma.TrainerProfileWhereInput = {
      organizationId: scope.organizationId,
      user: search
        ? {
            OR: [{ name: { contains: search } }, { email: { contains: search } }],
          }
        : undefined,
    };

    const orderBy: Prisma.TrainerProfileOrderByWithRelationInput =
      query.sortBy === "name" ? { user: { name: query.sortOrder } } : { createdAt: query.sortOrder };

    const [rows, total] = await Promise.all([
      prisma.trainerProfile.findMany({
        where,
        include: profileInclude,
        orderBy,
        ...paginationSkipTake(query),
      }),
      prisma.trainerProfile.count({ where }),
    ]);

    return {
      items: rows.map(toResponse),
      pagination: buildPaginationMeta(query.page, query.limit, total),
    };
  },

  /**
   * Users a manager can still attach a profile to. Gated on `trainers.manage` rather than
   * `users.manage` so a manager can do this job without seeing every colleague (1.19.3).
   */
  async candidates(scope: TrainerScope) {
    const users = await prisma.user.findMany({
      where: {
        organizationId: scope.organizationId,
        deletedAt: null,
        status: "ACTIVE",
        trainerProfile: { is: null },
      },
      select: {
        id: true,
        name: true,
        email: true,
        branchId: true,
        roleId: true,
        role: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    });

    const eligible: {
      id: string;
      name: string;
      email: string;
      branchId: string | null;
      roleName: string;
    }[] = [];

    for (const user of users) {
      const keys = await permissionKeysFor(user.roleId);
      if (keys.has("attendance.view") && !keys.has("trainers.manage")) {
        eligible.push({
          id: user.id,
          name: user.name,
          email: user.email,
          branchId: user.branchId,
          roleName: user.role.name,
        });
      }
    }

    return eligible;
  },

  async getById(scope: TrainerScope, trainerId: string): Promise<TrainerProfileResponse> {
    return toResponse(await findProfileOrThrow(scope, trainerId));
  },

  async create(
    scope: TrainerScope,
    input: CreateTrainerProfileInput,
  ): Promise<TrainerProfileResponse> {
    await assertUserIsEligible(scope.organizationId, input.userId);

    const existing = await prisma.trainerProfile.findUnique({
      where: { userId: input.userId },
      select: { id: true },
    });
    if (existing) {
      throw AppError.conflict(
        ErrorCode.TRAINER_PROFILE_EXISTS,
        "That staff member already has a trainer profile",
      );
    }

    const created = await prisma.trainerProfile.create({
      data: withGeneratedId({
        organizationId: scope.organizationId,
        userId: input.userId,
        specialization: input.specialization?.trim() ? input.specialization.trim() : null,
        commissionPct: commissionDecimal(input.commissionPct) ?? null,
      }),
      include: profileInclude,
    });

    return toResponse(created);
  },

  async update(
    scope: TrainerScope,
    trainerId: string,
    input: UpdateTrainerProfileInput,
  ): Promise<TrainerProfileResponse> {
    await findProfileOrThrow(scope, trainerId);

    const data: Prisma.TrainerProfileUncheckedUpdateInput = {};
    if (input.specialization !== undefined) {
      data.specialization = input.specialization === null || input.specialization.trim() === ""
        ? null
        : input.specialization.trim();
    }
    if (input.commissionPct !== undefined) {
      data.commissionPct = commissionDecimal(input.commissionPct) ?? null;
    }

    const updated = await prisma.trainerProfile.update({
      where: { id: trainerId },
      data,
      include: profileInclude,
    });
    return toResponse(updated);
  },

  async assignMember(
    scope: TrainerScope,
    trainerId: string,
    input: AssignMemberInput,
  ): Promise<TrainerProfileResponse> {
    const profile = await findProfileOrThrow(scope, trainerId);

    const member = await prisma.member.findFirst({
      where: {
        id: input.memberId,
        organizationId: scope.organizationId,
        deletedAt: null,
        branchId: scope.branchId ?? undefined,
      },
    });
    if (!member) {
      throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, `Member "${input.memberId}" not found`);
    }
    if (member.status === "ARCHIVED") {
      throw AppError.notFound(
        ErrorCode.MEMBER_NOT_FOUND,
        `${member.firstName} ${member.lastName} is archived and cannot be assigned`,
      );
    }

    const already = profile.assignments.find((row) => row.memberId === member.id);
    if (already) return toResponse(profile);

    await prisma.trainerAssignment.create({
      data: withGeneratedId({
        organizationId: scope.organizationId,
        trainerProfileId: profile.id,
        memberId: member.id,
        assignedByUserId: scope.userId,
      }),
    });

    return toResponse(await findProfileOrThrow(scope, trainerId));
  },

  async unassignMember(
    scope: TrainerScope,
    trainerId: string,
    memberId: string,
  ): Promise<TrainerProfileResponse> {
    const profile = await findProfileOrThrow(scope, trainerId);
    const assignment = profile.assignments.find((row) => row.memberId === memberId);
    if (!assignment) {
      throw AppError.notFound(
        ErrorCode.ASSIGNMENT_NOT_FOUND,
        "That member is not on this trainer's roster",
      );
    }

    await prisma.trainerAssignment.delete({ where: { id: assignment.id } });
    return toResponse(await findProfileOrThrow(scope, trainerId));
  },
};
