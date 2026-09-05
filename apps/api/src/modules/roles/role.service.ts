import { prisma, withGeneratedId } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { buildPaginationMeta, paginationSkipTake } from "../../utils/pagination";
import type { CreateRoleInput, UpdateRoleInput, listRolesQuerySchema } from "./role.schema";
import type { z } from "zod";
import { organizationService } from "../organizations/organization.service";

type ListQuery = z.infer<typeof listRolesQuerySchema>;

const roleWithPermissions = {
  permissions: { include: { permission: true } },
} as const;

function serializeRole<T extends { permissions: { permission: { key: string } }[] }>(role: T) {
  const { permissions, ...rest } = role;
  return { ...rest, permissionKeys: permissions.map((p) => p.permission.key) };
}

async function resolvePermissionIds(permissionKeys: string[]) {
  if (permissionKeys.length === 0) return [];

  const found = await prisma.permission.findMany({ where: { key: { in: permissionKeys } } });
  const foundKeys = new Set(found.map((p) => p.key));
  const missing = permissionKeys.filter((key) => !foundKeys.has(key));

  if (missing.length > 0) {
    throw AppError.badRequest(
      ErrorCode.PERMISSION_NOT_FOUND,
      `Unknown permission key(s): ${missing.join(", ")}`,
    );
  }

  return found.map((p) => p.id);
}

export const roleService = {
  async create(organizationId: string, input: CreateRoleInput) {
    await organizationService.getById(organizationId);

    const existing = await prisma.role.findUnique({
      where: { organizationId_name: { organizationId, name: input.name } },
    });
    if (existing) {
      throw AppError.conflict(
        ErrorCode.DUPLICATE_ROLE_NAME,
        `A role named "${input.name}" already exists in this organization`,
      );
    }

    const permissionIds = await resolvePermissionIds(input.permissionKeys);

    const role = await prisma.role.create({
      data: withGeneratedId({
        organizationId,
        name: input.name,
        permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
      }),
      include: roleWithPermissions,
    });

    return serializeRole(role);
  },

  async list(organizationId: string, query: ListQuery) {
    const where = {
      organizationId,
      ...(query.search ? { name: { contains: query.search } } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.role.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        include: roleWithPermissions,
        ...paginationSkipTake(query),
      }),
      prisma.role.count({ where }),
    ]);

    return {
      items: items.map(serializeRole),
      pagination: buildPaginationMeta(query.page, query.limit, total),
    };
  },

  async getById(organizationId: string, roleId: string) {
    const role = await prisma.role.findFirst({
      where: { id: roleId, organizationId },
      include: roleWithPermissions,
    });
    if (!role) {
      throw AppError.notFound(ErrorCode.ROLE_NOT_FOUND, `Role "${roleId}" not found`);
    }
    return serializeRole(role);
  },

  async update(organizationId: string, roleId: string, input: UpdateRoleInput) {
    const existing = await prisma.role.findFirst({ where: { id: roleId, organizationId } });
    if (!existing) {
      throw AppError.notFound(ErrorCode.ROLE_NOT_FOUND, `Role "${roleId}" not found`);
    }

    if (input.name && input.name !== existing.name) {
      const duplicate = await prisma.role.findUnique({
        where: { organizationId_name: { organizationId, name: input.name } },
      });
      if (duplicate) {
        throw AppError.conflict(
          ErrorCode.DUPLICATE_ROLE_NAME,
          `A role named "${input.name}" already exists in this organization`,
        );
      }
    }

    const permissionIds =
      input.permissionKeys !== undefined ? await resolvePermissionIds(input.permissionKeys) : null;

    const role = await prisma.$transaction(async (tx) => {
      if (permissionIds !== null) {
        await tx.rolePermission.deleteMany({ where: { roleId } });
      }

      return tx.role.update({
        where: { id: roleId },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(permissionIds !== null
            ? { permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) } }
            : {}),
        },
        include: roleWithPermissions,
      });
    });

    return serializeRole(role);
  },
};
