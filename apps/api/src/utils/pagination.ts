import { z } from "zod";

/**
 * Shared list-endpoint query convention — docs/architecture/DEVELOPMENT_PLAN.md Locked
 * Decision 1.9: `?page=&limit=&search=&status=&sortBy=&sortOrder=`. Every module's list
 * endpoint builds its query schema from `createListQuerySchema(...)`, then `.extend({ status })`
 * with its own status enum (kept separate so each module gets a precisely-typed `status`
 * literal union instead of a generic `string`).
 */
export function createListQuerySchema<SortField extends string>(
  sortableFields: readonly [SortField, ...SortField[]],
) {
  return z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().optional(),
    sortBy: z.enum(sortableFields as [SortField, ...SortField[]]).default(sortableFields[0]),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),
  });
}

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export function paginationSkipTake(query: { page: number; limit: number }) {
  return { skip: (query.page - 1) * query.limit, take: query.limit };
}
