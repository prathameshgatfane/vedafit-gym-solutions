import { Prisma, type ExpenseCategory } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { prisma, withGeneratedId } from "../../lib/prisma";
import { formatCalendarDate, parseCalendarDate } from "../../utils/dates";
import { toDecimal } from "../../utils/money";
import { buildPaginationMeta, paginationSkipTake } from "../../utils/pagination";
import type { CreateExpenseInput, ListExpensesQuery, UpdateExpenseInput } from "./expense.schema";

export interface ExpenseScope {
  organizationId: string;
  branchId: string | null;
  userId: string;
}

const expenseInclude = {
  branch: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.ExpenseInclude;

type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;

export interface ExpenseResponse {
  id: string;
  organizationId: string;
  branchId: string | null;
  category: ExpenseCategory;
  amount: string;
  expenseDate: string;
  paidTo: string | null;
  notes: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  branch: ExpenseRow["branch"];
  createdBy: ExpenseRow["createdBy"];
}

function toResponse(row: ExpenseRow): ExpenseResponse {
  return {
    id: row.id,
    organizationId: row.organizationId,
    branchId: row.branchId,
    category: row.category,
    amount: row.amount.toFixed(2),
    expenseDate: formatCalendarDate(row.expenseDate),
    paidTo: row.paidTo,
    notes: row.notes,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    branch: row.branch,
    createdBy: row.createdBy,
  };
}

function stampBranchId(scope: ExpenseScope, requested?: string | null): string | null {
  if (scope.branchId) return scope.branchId;
  if (requested === undefined) return null;
  return requested;
}

async function assertBranchInOrg(organizationId: string, branchId: string) {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, organizationId },
    select: { id: true },
  });
  if (!branch) {
    throw AppError.notFound(ErrorCode.BRANCH_NOT_FOUND, `Branch "${branchId}" not found`);
  }
}

async function findExpenseOrThrow(scope: ExpenseScope, expenseId: string): Promise<ExpenseRow> {
  const expense = await prisma.expense.findFirst({
    where: {
      id: expenseId,
      organizationId: scope.organizationId,
      branchId: scope.branchId ?? undefined,
    },
    include: expenseInclude,
  });
  if (!expense) {
    throw AppError.notFound(ErrorCode.EXPENSE_NOT_FOUND, `Expense "${expenseId}" not found`);
  }
  return expense;
}

export const expenseService = {
  async list(scope: ExpenseScope, query: ListExpensesQuery) {
    const search = query.search?.trim();
    const where: Prisma.ExpenseWhereInput = {
      organizationId: scope.organizationId,
      branchId: scope.branchId ?? query.branchId,
      category: query.category,
      OR: search
        ? [{ paidTo: { contains: search } }, { notes: { contains: search } }]
        : undefined,
    };

    const orderBy: Prisma.ExpenseOrderByWithRelationInput =
      query.sortBy === "amount"
        ? { amount: query.sortOrder }
        : query.sortBy === "createdAt"
          ? { createdAt: query.sortOrder }
          : { expenseDate: query.sortOrder };

    const [rows, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        include: expenseInclude,
        orderBy,
        ...paginationSkipTake(query),
      }),
      prisma.expense.count({ where }),
    ]);

    return {
      items: rows.map(toResponse),
      pagination: buildPaginationMeta(query.page, query.limit, total),
    };
  },

  async getById(scope: ExpenseScope, expenseId: string): Promise<ExpenseResponse> {
    return toResponse(await findExpenseOrThrow(scope, expenseId));
  },

  async create(scope: ExpenseScope, input: CreateExpenseInput): Promise<ExpenseResponse> {
    const branchId = stampBranchId(scope, input.branchId);
    if (branchId) await assertBranchInOrg(scope.organizationId, branchId);

    const created = await prisma.expense.create({
      data: withGeneratedId({
        organizationId: scope.organizationId,
        branchId,
        category: input.category,
        amount: toDecimal(input.amount),
        expenseDate: parseCalendarDate(input.expenseDate),
        paidTo: input.paidTo?.trim() ? input.paidTo.trim() : null,
        notes: input.notes?.trim() ? input.notes.trim() : null,
        createdByUserId: scope.userId,
      }),
      include: expenseInclude,
    });

    return toResponse(created);
  },

  async update(
    scope: ExpenseScope,
    expenseId: string,
    input: UpdateExpenseInput,
  ): Promise<ExpenseResponse> {
    await findExpenseOrThrow(scope, expenseId);

    let nextBranchId: string | null | undefined = input.branchId;
    if (scope.branchId) {
      if (input.branchId && input.branchId !== scope.branchId) {
        throw AppError.notFound(ErrorCode.EXPENSE_NOT_FOUND, `Expense "${expenseId}" not found`);
      }
      nextBranchId = undefined;
    }
    if (nextBranchId) await assertBranchInOrg(scope.organizationId, nextBranchId);

    const data: Prisma.ExpenseUncheckedUpdateInput = {};
    if (input.category !== undefined) data.category = input.category;
    if (input.amount !== undefined) data.amount = toDecimal(input.amount);
    if (input.expenseDate !== undefined) data.expenseDate = parseCalendarDate(input.expenseDate);
    if (nextBranchId !== undefined) data.branchId = nextBranchId;
    if (input.paidTo !== undefined) data.paidTo = input.paidTo;
    if (input.notes !== undefined) data.notes = input.notes;

    const updated = await prisma.expense.update({
      where: { id: expenseId },
      data,
      include: expenseInclude,
    });
    return toResponse(updated);
  },

  async remove(scope: ExpenseScope, expenseId: string): Promise<void> {
    await findExpenseOrThrow(scope, expenseId);
    await prisma.expense.delete({ where: { id: expenseId } });
  },
};
