import { Prisma } from "@prisma/client";
import { prisma, withGeneratedId } from "../../lib/prisma";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { buildPaginationMeta, paginationSkipTake } from "../../utils/pagination";
import type {
  CreateOrganizationInput,
  UpdateOrganizationInput,
  listOrganizationsQuerySchema,
} from "./organization.schema";
import type { z } from "zod";

type ListQuery = z.infer<typeof listOrganizationsQuerySchema>;

export const organizationService = {
  async create(input: CreateOrganizationInput) {
    const existing = await prisma.organization.findUnique({ where: { slug: input.slug } });
    if (existing) {
      throw AppError.conflict(
        ErrorCode.DUPLICATE_ORGANIZATION_SLUG,
        `An organization with slug "${input.slug}" already exists`,
      );
    }

    return prisma.organization.create({ data: withGeneratedId(input) });
  },

  async list(query: ListQuery) {
    const where: Prisma.OrganizationWhereInput = {
      status: query.status,
      OR: query.search
        ? [
            { name: { contains: query.search } },
            { slug: { contains: query.search } },
            { email: { contains: query.search } },
          ]
        : undefined,
    };

    const [items, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        ...paginationSkipTake(query),
      }),
      prisma.organization.count({ where }),
    ]);

    return { items, pagination: buildPaginationMeta(query.page, query.limit, total) };
  },

  async getById(id: string) {
    const org = await prisma.organization.findUnique({ where: { id } });
    if (!org) {
      throw AppError.notFound(ErrorCode.ORGANIZATION_NOT_FOUND, `Organization "${id}" not found`);
    }
    return org;
  },

  async update(id: string, input: UpdateOrganizationInput) {
    await organizationService.getById(id);
    return prisma.organization.update({ where: { id }, data: input });
  },

  /**
   * Platform-only lifecycle switch (Phase 15.7). Writes `organizations.status` and nothing else —
   * subscription TRIAL/ACTIVE/PAST_DUE/CANCELLED stays on `organization_subscriptions` (10.13).
   */
  async setStatus(id: string, status: "ACTIVE" | "SUSPENDED") {
    await organizationService.getById(id);
    return prisma.organization.update({ where: { id }, data: { status } });
  },
};
