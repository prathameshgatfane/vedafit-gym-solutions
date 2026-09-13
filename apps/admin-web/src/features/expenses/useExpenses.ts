import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useSessionStore } from "../../stores/session.store";
import {
  createExpense,
  deleteExpense,
  getExpense,
  getProfitLoss,
  listExpenses,
  updateExpense,
  type ExpensePage,
} from "./expenses.api";
import type { ExpenseFormValues } from "./expense.schema";
import type { Expense, ExpenseListParams, ProfitLossReport } from "./expense.types";

export const expenseKeys = {
  all: (organizationId: string) => ["expenses", organizationId] as const,
  list: (organizationId: string, params: ExpenseListParams) =>
    ["expenses", organizationId, "list", params] as const,
  detail: (organizationId: string, expenseId: string) =>
    ["expenses", organizationId, "detail", expenseId] as const,
};

export const reportKeys = {
  profitLoss: (
    organizationId: string,
    query: { from?: string; to?: string; branchId?: string },
  ) => ["reports", organizationId, "profit-loss", query] as const,
};

function useOrganizationId(): string {
  return useSessionStore((s) => s.organization?.id) ?? "";
}

export function useExpenseList(params: ExpenseListParams): UseQueryResult<ExpensePage> {
  const organizationId = useOrganizationId();
  return useQuery({
    queryKey: expenseKeys.list(organizationId, params),
    queryFn: () => listExpenses(organizationId, params),
    enabled: organizationId !== "",
    placeholderData: keepPreviousData,
  });
}

export function useExpense(expenseId: string | undefined): UseQueryResult<Expense> {
  const organizationId = useOrganizationId();
  return useQuery({
    queryKey: expenseKeys.detail(organizationId, expenseId ?? ""),
    queryFn: () => getExpense(organizationId, expenseId!),
    enabled: organizationId !== "" && Boolean(expenseId),
  });
}

export function useCreateExpense(): UseMutationResult<Expense, unknown, ExpenseFormValues> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: ExpenseFormValues) => createExpense(organizationId, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: expenseKeys.all(organizationId) });
      void queryClient.invalidateQueries({ queryKey: ["reports", organizationId] });
    },
  });
}

export function useUpdateExpense(
  expenseId: string,
): UseMutationResult<Expense, unknown, ExpenseFormValues> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: ExpenseFormValues) => updateExpense(organizationId, expenseId, values),
    onSuccess: (expense) => {
      queryClient.setQueryData(expenseKeys.detail(organizationId, expenseId), expense);
      void queryClient.invalidateQueries({ queryKey: expenseKeys.all(organizationId) });
      void queryClient.invalidateQueries({ queryKey: ["reports", organizationId] });
    },
  });
}

export function useDeleteExpense(): UseMutationResult<void, unknown, string> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (expenseId: string) => deleteExpense(organizationId, expenseId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: expenseKeys.all(organizationId) });
      void queryClient.invalidateQueries({ queryKey: ["reports", organizationId] });
    },
  });
}

export function useProfitLoss(query: {
  from?: string;
  to?: string;
  branchId?: string;
}): UseQueryResult<ProfitLossReport> {
  const organizationId = useOrganizationId();
  return useQuery({
    queryKey: reportKeys.profitLoss(organizationId, query),
    queryFn: () => getProfitLoss(organizationId, query),
    enabled: organizationId !== "",
  });
}
