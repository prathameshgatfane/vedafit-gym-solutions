import { Prisma } from "@prisma/client";
import { prisma, withGeneratedId, type TransactionClient } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { buildPaginationMeta, paginationSkipTake } from "../../utils/pagination";
import type { CreateBranchInput, UpdateBranchInput, listBranchesQuerySchema } from "./branch.schema";
import type { z } from "zod";
import { organizationService } from "../organizations/organization.service";
import { SAAS_ENTITLEMENT_KEY } from "../saas/saas-catalog";
import { assertEntitlement } from "../saas/saas-entitlements.service";

type ListQuery = z.infer<typeof listBranchesQuerySchema>;

export const branchService = {
  async create(organizationId: string, input: CreateBranchInput) {
    await organizationService.getById(organizationId); // 404s if org doesn't exist
    return prisma.$transaction(async (tx: TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
      await assertEntitlement(organizationId, SAAS_ENTITLEMENT_KEY.BRANCHES_MAX, { db: tx });
      return tx.branch.create({ data: withGeneratedId({ ...input, organizationId }) });
    });
  },

  async list(organizationId: string, query: ListQuery) {
    const where: Prisma.BranchWhereInput = {
      organizationId,
      status: query.status,
      name: query.search ? { contains: query.search } : undefined,
    };

    const [items, total] = await Promise.all([
      prisma.branch.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        ...paginationSkipTake(query),
      }),
      prisma.branch.count({ where }),
    ]);

    return { items, pagination: buildPaginationMeta(query.page, query.limit, total) };
  },

  async getById(organizationId: string, branchId: string) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) {
      throw AppError.notFound(ErrorCode.BRANCH_NOT_FOUND, `Branch "${branchId}" not found`);
    }
    return branch;
  },

  async update(organizationId: string, branchId: string, input: UpdateBranchInput) {
    await branchService.getById(organizationId, branchId);
    return prisma.branch.update({ where: { id: branchId }, data: input });
  },
};
