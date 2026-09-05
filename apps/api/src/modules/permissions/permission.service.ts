import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { buildPaginationMeta, paginationSkipTake } from "../../utils/pagination";
import type { listPermissionsQuerySchema } from "./permission.schema";
import type { z } from "zod";

type ListQuery = z.infer<typeof listPermissionsQuerySchema>;

export const permissionService = {
  async list(query: ListQuery) {
    const where = query.search
      ? { OR: [{ key: { contains: query.search } }, { description: { contains: query.search } }] }
      : {};

    const [items, total] = await Promise.all([
      prisma.permission.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        ...paginationSkipTake(query),
      }),
      prisma.permission.count({ where }),
    ]);

    return { items, pagination: buildPaginationMeta(query.page, query.limit, total) };
  },

  async getById(permissionId: string) {
    const permission = await prisma.permission.findUnique({ where: { id: permissionId } });
    if (!permission) {
      throw AppError.notFound(
        ErrorCode.PERMISSION_NOT_FOUND,
        `Permission "${permissionId}" not found`,
      );
    }
    return permission;
  },
};
