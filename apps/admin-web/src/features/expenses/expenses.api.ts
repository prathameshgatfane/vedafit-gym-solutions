import { apiClient, type ApiPaginated, type ApiSuccess } from "../../lib/api-client";
import type { ExpenseFormValues } from "./expense.schema";
import type { Expense, ExpenseListParams, ProfitLossReport } from "./expense.types";

export interface ExpensePage {
  items: Expense[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function expensesPath(organizationId: string, suffix = ""): string {
  return `/organizations/${organizationId}/expenses${suffix}`;
}

function toQuery(params: ExpenseListParams): Record<string, string | number> {
  const query: Record<string, string | number> = {
    page: params.page,
    limit: params.limit,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  };
  if (params.search.trim()) query.search = params.search.trim();
  if (params.status) query.category = params.status;
  return query;
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toPayload(values: ExpenseFormValues, mode: "create" | "edit") {
  const paidTo = emptyToNull(values.paidTo);
  const notes = emptyToNull(values.notes);
  const branchId = emptyToNull(values.branchId);
  const amount = Number(values.amount);

  if (mode === "create") {
    return {
      category: values.category,
      amount,
      expenseDate: values.expenseDate,
      ...(branchId ? { branchId } : {}),
      ...(paidTo ? { paidTo } : {}),
      ...(notes ? { notes } : {}),
    };
  }

  return {
    category: values.category,
    amount,
    expenseDate: values.expenseDate,
    branchId,
    paidTo,
    notes,
  };
}

export async function listExpenses(
  organizationId: string,
  params: ExpenseListParams,
): Promise<ExpensePage> {
  const { data } = await apiClient.get<ApiPaginated<Expense>>(expensesPath(organizationId), {
    params: toQuery(params),
  });
  return { items: data.data, pagination: data.pagination };
}

export async function getExpense(organizationId: string, expenseId: string): Promise<Expense> {
  const { data } = await apiClient.get<ApiSuccess<Expense>>(
    expensesPath(organizationId, `/${expenseId}`),
  );
  return data.data;
}

export async function createExpense(
  organizationId: string,
  values: ExpenseFormValues,
): Promise<Expense> {
  const { data } = await apiClient.post<ApiSuccess<Expense>>(
    expensesPath(organizationId),
    toPayload(values, "create"),
  );
  return data.data;
}

export async function updateExpense(
  organizationId: string,
  expenseId: string,
  values: ExpenseFormValues,
): Promise<Expense> {
  const { data } = await apiClient.patch<ApiSuccess<Expense>>(
    expensesPath(organizationId, `/${expenseId}`),
    toPayload(values, "edit"),
  );
  return data.data;
}

export async function deleteExpense(organizationId: string, expenseId: string): Promise<void> {
  await apiClient.delete(expensesPath(organizationId, `/${expenseId}`));
}

export async function getProfitLoss(
  organizationId: string,
  query: { from?: string; to?: string; branchId?: string },
): Promise<ProfitLossReport> {
  const { data } = await apiClient.get<ApiSuccess<ProfitLossReport>>(
    `/organizations/${organizationId}/reports/profit-loss`,
    { params: query },
  );
  return data.data;
}
