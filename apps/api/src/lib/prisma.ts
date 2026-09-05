import { PrismaClient } from "@prisma/client";
import { generateId } from "./id";

/**
 * Prisma Client Extension that auto-populates `id` on `create` / `createMany` / `upsert.create`
 * when the caller didn't already set one — see docs/architecture/DEVELOPMENT_PLAN.md Locked
 * Decision 1.2. Individual services should never need to call `generateId()` themselves; this
 * runs for every model automatically.
 */
// Models with a composite primary key (no standalone `id` scalar) — the extension must not
// inject `id` for these, or Prisma rejects the write with "Unknown argument `id`".
const MODELS_WITHOUT_ID_COLUMN = new Set(["RolePermission"]);

function withIdGeneration(client: PrismaClient) {
  return client.$extends({
    name: "id-generation",
    query: {
      $allModels: {
        async create({ model, args, query }) {
          if (MODELS_WITHOUT_ID_COLUMN.has(model)) return query(args);
          const data = args.data as Record<string, unknown>;
          if (data && typeof data === "object" && !("id" in data && data.id)) {
            data.id = generateId();
          }
          return query(args);
        },
        async createMany({ model, args, query }) {
          if (MODELS_WITHOUT_ID_COLUMN.has(model)) return query(args);
          const data = args.data as Record<string, unknown> | Record<string, unknown>[];
          const rows = Array.isArray(data) ? data : [data];
          for (const row of rows) {
            if (row && typeof row === "object" && !("id" in row && row.id)) {
              row.id = generateId();
            }
          }
          return query(args);
        },
        async upsert({ model, args, query }) {
          if (MODELS_WITHOUT_ID_COLUMN.has(model)) return query(args);
          const createData = args.create as Record<string, unknown>;
          if (createData && typeof createData === "object" && !("id" in createData && createData.id)) {
            createData.id = generateId();
          }
          return query(args);
        },
      },
    },
  });
}

const basePrismaClient = new PrismaClient();

/**
 * The extended Prisma Client — import this everywhere in the app instead of instantiating
 * `PrismaClient` directly, so ID generation is never accidentally skipped.
 */
export const prisma = withIdGeneration(basePrismaClient);

export type Prisma = typeof prisma;

/**
 * Prisma's generated `XCreateInput` types require `id` (schema.prisma has no `@default` on any
 * id field, per Locked Decision 1.2 — no DB/Prisma default generator). The `withIdGeneration`
 * extension supplies it at runtime before the query actually runs, so call sites that omit `id`
 * are correct at runtime but fail static typechecking. This cast documents *why* that's safe
 * instead of sprinkling unexplained `as any` at every `.create()` call site.
 */
export function withGeneratedId<T extends Record<string, unknown>>(data: T): T & { id: string } {
  return data as T & { id: string };
}

/**
 * The exact `tx` parameter type our extended `prisma.$transaction(async (tx) => ...)` callback
 * provides — use this (not `Prisma.TransactionClient`, which is the type for the *unextended*
 * client) when a helper function needs to accept a transaction client as a parameter.
 */
export type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
