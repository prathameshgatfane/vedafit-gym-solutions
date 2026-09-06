import { Prisma, type Member } from "@prisma/client";
import { prisma, withGeneratedId, type TransactionClient } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { buildPaginationMeta, paginationSkipTake } from "../../utils/pagination";
import type {
  CreateMemberInput,
  ListMembersQuery,
  UpdateMemberInput,
} from "./member.schema";

/**
 * Who is asking, as derived from the JWT — never from the request body.
 * `branchId: null` means an org-wide role (OWNER/ADMIN/ACCOUNTANT); anything else pins every
 * read and write to that one branch.
 */
export interface MemberScope {
  organizationId: string;
  branchId: string | null;
}

/**
 * "Taken" means taken by a member who is still on the books. Archived members keep their phone
 * number on their record for history, but it stops blocking new signups — a gym that loses a
 * member and gains them back a year later should not have to invent a fake number.
 * `deletedAt` is in here too so the check stays correct if a later phase starts using it.
 */
const ACTIVE_MEMBER: Prisma.MemberWhereInput = {
  deletedAt: null,
  status: { not: "ARCHIVED" },
};

/**
 * Same InnoDB row lock the users module uses, for the same reason: under MySQL's default
 * REPEATABLE READ, two concurrent "check then create" transactions can both see "no existing
 * phone" and both insert. Locking the parent organization row serializes member writes within
 * one organization, which is what makes Locked Decision 1.3's app-layer uniqueness actually
 * hold. Still no DB-level `@@unique` — that decision is unchanged.
 */
async function lockOrganizationForWrite(tx: TransactionClient, organizationId: string) {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
}

async function assertPhoneIsFree(
  tx: TransactionClient,
  organizationId: string,
  phone: string,
  excludeMemberId?: string,
) {
  const existing = await tx.member.findFirst({
    where: {
      ...ACTIVE_MEMBER,
      organizationId,
      phone,
      id: excludeMemberId ? { not: excludeMemberId } : undefined,
    },
    select: { id: true, firstName: true, lastName: true },
  });

  if (existing) {
    throw AppError.conflict(
      ErrorCode.DUPLICATE_PHONE,
      // Naming the clashing member turns a dead end into a next step: staff can go look them up
      // instead of guessing whether they fat-fingered the number.
      `Phone number ${phone} already belongs to ${existing.firstName} ${existing.lastName}`,
      { conflictingMemberId: existing.id },
    );
  }
}

async function assertBranchBelongsToOrg(
  tx: TransactionClient,
  organizationId: string,
  branchId: string,
) {
  const branch = await tx.branch.findFirst({
    where: { id: branchId, organizationId },
    select: { id: true },
  });
  if (!branch) {
    throw AppError.notFound(ErrorCode.BRANCH_NOT_FOUND, `Branch "${branchId}" not found`);
  }
}

/** Stored at UTC midnight so a calendar date can't drift across timezones. */
function toDateOfBirth(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export interface MemberResponse extends Omit<Member, "dateOfBirth" | "deletedAt"> {
  /** Serialized back as `YYYY-MM-DD` for the same reason it's parsed that way. */
  dateOfBirth: string | null;
}

function toResponse(member: Member): MemberResponse {
  const { deletedAt: _deletedAt, dateOfBirth, ...rest } = member;
  return {
    ...rest,
    dateOfBirth: dateOfBirth ? dateOfBirth.toISOString().slice(0, 10) : null,
  };
}

/**
 * A branch-scoped caller only ever sees their own branch. `tenantScope` already rejects them for
 * *naming* another branch; this covers the other half — omitting `branchId` entirely, which would
 * otherwise return the whole organization's members.
 */
function resolveBranchFilter(scope: MemberScope, requested?: string): string | undefined {
  return scope.branchId ?? requested;
}

export const memberService = {
  async create(scope: MemberScope, input: CreateMemberInput): Promise<MemberResponse> {
    const member = await prisma.$transaction(async (tx) => {
      await lockOrganizationForWrite(tx, scope.organizationId);
      await assertBranchBelongsToOrg(tx, scope.organizationId, input.branchId);
      await assertPhoneIsFree(tx, scope.organizationId, input.phone);

      return tx.member.create({
        data: withGeneratedId({
          organizationId: scope.organizationId,
          branchId: input.branchId,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          email: input.email ?? null,
          dateOfBirth: input.dateOfBirth ? toDateOfBirth(input.dateOfBirth) : null,
        }),
      });
    });

    return toResponse(member);
  },

  async list(scope: MemberScope, query: ListMembersQuery) {
    const search = query.search;

    const where: Prisma.MemberWhereInput = {
      organizationId: scope.organizationId,
      deletedAt: null,
      branchId: resolveBranchFilter(scope, query.branchId),
      // No status filter means "everyone currently on the books" — archived members are the
      // long tail and would otherwise crowd out the list staff actually work from. Ask for them
      // explicitly with `?status=ARCHIVED`.
      status: query.status ?? { not: "ARCHIVED" },
      OR: search
        ? [
            { firstName: { contains: search } },
            { lastName: { contains: search } },
            { phone: { contains: search } },
            { email: { contains: search } },
          ]
        : undefined,
    };

    const [items, total] = await Promise.all([
      prisma.member.findMany({
        where,
        // `id` breaks ties so a member can't appear on two pages (or on neither) when several
        // rows share a sort value — very likely on `firstName`, and on `createdAt` for a bulk import.
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "asc" }],
        ...paginationSkipTake(query),
      }),
      prisma.member.count({ where }),
    ]);

    return {
      items: items.map(toResponse),
      pagination: buildPaginationMeta(query.page, query.limit, total),
    };
  },

  async getById(scope: MemberScope, memberId: string): Promise<MemberResponse> {
    const member = await prisma.member.findFirst({
      where: {
        id: memberId,
        organizationId: scope.organizationId,
        branchId: scope.branchId ?? undefined,
        deletedAt: null,
      },
    });

    if (!member) {
      // Also the answer when the member exists in another branch and the caller is branch-scoped:
      // "not found" rather than "forbidden", so the endpoint isn't an existence oracle.
      throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, `Member "${memberId}" not found`);
    }

    return toResponse(member);
  },

  async update(
    scope: MemberScope,
    memberId: string,
    input: UpdateMemberInput,
  ): Promise<MemberResponse> {
    const member = await prisma.$transaction(async (tx) => {
      await lockOrganizationForWrite(tx, scope.organizationId);

      const existing = await tx.member.findFirst({
        where: {
          id: memberId,
          organizationId: scope.organizationId,
          branchId: scope.branchId ?? undefined,
          deletedAt: null,
        },
      });
      if (!existing) {
        throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, `Member "${memberId}" not found`);
      }

      if (input.branchId && input.branchId !== existing.branchId) {
        await assertBranchBelongsToOrg(tx, scope.organizationId, input.branchId);
      }

      if (input.phone && input.phone !== existing.phone) {
        await assertPhoneIsFree(tx, scope.organizationId, input.phone, memberId);
      }

      const data: Prisma.MemberUncheckedUpdateInput = {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        email: input.email,
        branchId: input.branchId,
        status: input.status,
      };

      // `undefined` means "not supplied", `null` means "clear it" — so this can't collapse into
      // the object literal above the way the other optional fields do.
      if (input.dateOfBirth !== undefined) {
        data.dateOfBirth = input.dateOfBirth === null ? null : toDateOfBirth(input.dateOfBirth);
      }

      return tx.member.update({ where: { id: memberId }, data });
    });

    return toResponse(member);
  },

  /**
   * Archiving is a status transition, not a delete: the record stays fully readable, keeps its
   * history, and can be listed with `?status=ARCHIVED`. `deletedAt` is deliberately left alone —
   * see DEVELOPMENT_PLAN.md Section 9 (2026-09-06).
   */
  async archive(scope: MemberScope, memberId: string): Promise<MemberResponse> {
    const existing = await prisma.member.findFirst({
      where: {
        id: memberId,
        organizationId: scope.organizationId,
        branchId: scope.branchId ?? undefined,
        deletedAt: null,
      },
    });

    if (!existing) {
      throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, `Member "${memberId}" not found`);
    }

    if (existing.status === "ARCHIVED") {
      // Idempotent: re-archiving is a no-op, not an error. Two staff clicking the same button is
      // not something to surface a failure for.
      return toResponse(existing);
    }

    const member = await prisma.member.update({
      where: { id: memberId },
      data: { status: "ARCHIVED" },
    });

    return toResponse(member);
  },
};
