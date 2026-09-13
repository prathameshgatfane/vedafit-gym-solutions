import type { ListParams } from "../../lib/url-list-params";

export const EXPENSE_CATEGORIES = [
  "RENT",
  "UTILITIES",
  "SALARIES",
  "EQUIPMENT",
  "MARKETING",
  "SOFTWARE",
  "MAINTENANCE",
  "SUPPLIES",
  "PROFESSIONAL_FEES",
  "OTHER",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  RENT: "Rent",
  UTILITIES: "Utilities",
  SALARIES: "Salaries",
  EQUIPMENT: "Equipment",
  MARKETING: "Marketing",
  SOFTWARE: "Software",
  MAINTENANCE: "Maintenance",
  SUPPLIES: "Supplies",
  PROFESSIONAL_FEES: "Professional fees",
  OTHER: "Other",
};

export interface Expense {
  id: string;
  organizationId: string;
  branchId: string | null;
  category: ExpenseCategory;
  amount: string;
  expenseDate: string;
  paidTo: string | null;
  notes: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  branch: { id: string; name: string } | null;
  createdBy: { id: string; name: string; email: string };
}

export type ExpenseSortField = "expenseDate" | "amount" | "createdAt";

export type ExpenseListParams = ListParams<ExpenseSortField, ExpenseCategory>;

export const DEFAULT_EXPENSE_LIST_PARAMS: ExpenseListParams = {
  page: 1,
  limit: 10,
  search: "",
  status: "",
  sortBy: "expenseDate",
  sortOrder: "desc",
};

export interface ProfitLossCategory {
  category: ExpenseCategory;
  total: string;
}

export interface ProfitLossReport {
  timezone: string;
  from: string;
  to: string;
  scope: { branchId: string | null; branchName: string | null };
  revenue: string;
  expenses: string;
  net: string;
  byCategory: ProfitLossCategory[];
}
