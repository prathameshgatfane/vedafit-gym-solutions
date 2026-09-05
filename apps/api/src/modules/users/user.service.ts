import { Prisma } from "@prisma/client";
import { prisma, withGeneratedId, type TransactionClient } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { hashPassword } from "../../lib/password";
import { buildPaginationMeta, paginationSkipTake } from "../../utils/pagination";
import type { CreateUserInput, UpdateUserInput, listUsersQuerySchema } from "./user.schema";
import type { z } from "zod";
import { organizationService } from "../organizations/organization.service";

type ListQuery = z.infer<typeof listUsersQuerySchema>;

function omitPasswordHash<T extends { passwordHash: string }>(user: T) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

async function assertRoleAndBranchBelongToOrg(
  tx: TransactionClient,
  organizationId: string,
  roleId: string,
  branchId: string | null | undefined,
) {
  const role = await tx.role.findFirst({ where: { id: roleId, organizationId } });
  if (!role) {
    throw AppError.notFound(ErrorCode.ROLE_NOT_FOUND, `Role "${roleId}" not found`);
  }

  if (branchId) {
    const branch = await tx.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) {
      throw AppError.notFound(ErrorCode.BRANCH_NOT_FOUND, `Branch "${branchId}" not found`);
    }
  }
}

/**
 * Locks the organization row for the duration of the surrounding transaction (InnoDB
 * `SELECT ... FOR UPDATE`). This serializes concurrent user-create/update calls for the SAME
 * organization, which closes the check-then-write race that a plain "find, then create" would
 * otherwise have — see docs/architecture/DEVELOPMENT_PLAN.md Locked Decision 1.3. We still do
 * NOT add a DB-level `@@unique` on `(organizationId, email)` (that decision is unchanged); this
 * lock is a app-layer concurrency-control detail, not a schema-level uniqueness mechanism, and
 * it only serializes writes within one organization (cheap: user creation is low-frequency,
 * admin-driven traffic, never a hot path).
 */
async function lockOrganizationForWrite(tx: TransactionClient, organizationId: string) {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
}

export const userService = {
  async create(organizationId: string, input: CreateUserInput) {
    await organizationService.getById(organizationId);

    const user = await prisma.$transaction(async (tx) => {
      await lockOrganizationForWrite(tx, organizationId);
      await assertRoleAndBranchBelongToOrg(tx, organizationId, input.roleId, input.branchId);

      const existing = await tx.user.findFirst({
        where: { organizationId, email: input.email, deletedAt: null },
      });
      if (existing) {
        throw AppError.conflict(
          ErrorCode.DUPLICATE_EMAIL,
          `A user with email "${input.email}" already exists in this organization`,
        );
      }

      const passwordHash = await hashPassword(input.password);

      return tx.user.create({
        data: withGeneratedId({
          organizationId,
          name: input.name,
          email: input.email,
          passwordHash,
          roleId: input.roleId,
          branchId: input.branchId ?? null,
        }),
      });
    });

    return omitPasswordHash(user);
  },

  async list(organizationId: string, query: ListQuery) {
    const where: Prisma.UserWhereInput = {
      organizationId,
      deletedAt: null,
      status: query.status,
      OR: query.search
        ? [{ name: { contains: query.search } }, { email: { contains: query.search } }]
        : undefined,
    };

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        ...paginationSkipTake(query),
      }),
      prisma.user.count({ where }),
    ]);

    return { items: items.map(omitPasswordHash), pagination: buildPaginationMeta(query.page, query.limit, total) };
  },

  async getById(organizationId: string, userId: string) {
    const user = await prisma.user.findFirst({
      where: { id: userId, organizationId, deletedAt: null },
    });
    if (!user) {
      throw AppError.notFound(ErrorCode.USER_NOT_FOUND, `User "${userId}" not found`);
    }
    return omitPasswordHash(user);
  },

  async update(organizationId: string, userId: string, input: UpdateUserInput) {
    const user = await prisma.$transaction(async (tx) => {
      await lockOrganizationForWrite(tx, organizationId);

      const existing = await tx.user.findFirst({
        where: { id: userId, organizationId, deletedAt: null },
      });
      if (!existing) {
        throw AppError.notFound(ErrorCode.USER_NOT_FOUND, `User "${userId}" not found`);
      }

      if (input.roleId || input.branchId !== undefined) {
        await assertRoleAndBranchBelongToOrg(
          tx,
          organizationId,
          input.roleId ?? existing.roleId,
          input.branchId ?? undefined,
        );
      }

      if (input.email && input.email !== existing.email) {
        const duplicate = await tx.user.findFirst({
          where: { organizationId, email: input.email, deletedAt: null, id: { not: userId } },
        });
        if (duplicate) {
          throw AppError.conflict(
            ErrorCode.DUPLICATE_EMAIL,
            `A user with email "${input.email}" already exists in this organization`,
          );
        }
      }

      const passwordHash = input.password ? await hashPassword(input.password) : undefined;

      const data: Prisma.UserUncheckedUpdateInput = {
        name: input.name,
        email: input.email,
        passwordHash,
        roleId: input.roleId,
        branchId: input.branchId,
        status: input.status,
      };

      return tx.user.update({ where: { id: userId }, data });
    });

    return omitPasswordHash(user);
  },

  async softDelete(organizationId: string, userId: string) {
    const existing = await prisma.user.findFirst({
      where: { id: userId, organizationId, deletedAt: null },
    });
    if (!existing) {
      throw AppError.notFound(ErrorCode.USER_NOT_FOUND, `User "${userId}" not found`);
    }
    await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
  },
};
