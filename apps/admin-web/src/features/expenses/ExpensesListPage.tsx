import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { DataTable } from "../../components/ui/DataTable";
import { Select } from "../../components/ui/Select";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { formatPrice } from "../../lib/money";
import { useUrlListParams, type ListParamsConfig } from "../../lib/url-list-params";
import { useSessionStore } from "../../stores/session.store";
import {
  DEFAULT_EXPENSE_LIST_PARAMS,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
  type ExpenseSortField,
} from "./expense.types";
import { useDeleteExpense, useExpenseList } from "./useExpenses";

const CONFIG: ListParamsConfig<ExpenseSortField, ExpenseCategory> = {
  sortFields: ["expenseDate", "amount", "createdAt"],
  statuses: EXPENSE_CATEGORIES,
  defaults: DEFAULT_EXPENSE_LIST_PARAMS,
};

const CATEGORY_OPTIONS = EXPENSE_CATEGORIES.map((value) => ({
  value,
  label: EXPENSE_CATEGORY_LABELS[value],
}));

function pageSizeOptions(current: number) {
  const sizes = [10, 25, 50].includes(current)
    ? [10, 25, 50]
    : [current, 10, 25, 50].sort((a, b) => a - b);
  return sizes.map((size) => ({ value: String(size), label: `${size} per page` }));
}

export function ExpensesListPage() {
  const navigate = useNavigate();
  const { params, setParams, reset } = useUrlListParams(CONFIG);
  const canManage = useSessionStore((s) => s.hasPermission("expenses.manage"));
  const remove = useDeleteExpense();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [searchDraft, setSearchDraft] = useState(params.search);
  useEffect(() => setSearchDraft(params.search), [params.search]);
  useEffect(() => {
    if (searchDraft === params.search) return;
    const timer = setTimeout(() => setParams({ search: searchDraft }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, params.search, setParams]);

  const { data, isPending, isFetching, isError, error } = useExpenseList(params);
  const expenses = data?.items ?? [];
  const pagination = data?.pagination;
  const hasFilters = params.search !== "" || params.status !== "";

  async function confirmDelete(id: string) {
    setActionError(null);
    try {
      await remove.mutateAsync(id);
      setPendingDelete(null);
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not delete this expense."));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 data-testid="expenses-heading" className="text-2xl font-semibold text-fg">
            Expenses
          </h1>
          <p className="mt-1 text-sm text-accent-muted">
            {pagination
              ? `${pagination.total} ${pagination.total === 1 ? "expense" : "expenses"}${
                  hasFilters ? " matching your filters" : ""
                }`
              : "Loading expenses…"}
          </p>
        </div>
        {canManage ? (
          <Button data-testid="add-expense" onClick={() => navigate("/expenses/new")}>
            Add expense
          </Button>
        ) : null}
      </div>

      <p className="rounded-md border border-accent/25 bg-accent/5 px-4 py-3 text-sm text-accent-muted">
        This is a live book, not a ledger of reversals. Edit a slipped digit; delete a duplicate.
        Last month&apos;s P&amp;L will move with the correction.
      </p>

      <div
        data-testid="expenses-filter-bar"
        className="grid grid-cols-2 items-end gap-3 rounded-lg border border-border bg-surface p-4 md:flex md:flex-wrap"
      >
        <div className="col-span-2 min-w-0 md:min-w-56 md:flex-1">
          <TextField
            label="Search"
            type="search"
            placeholder="Payee or notes"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
          />
        </div>
        <Select
          label="Category"
          placeholder="Any category"
          options={CATEGORY_OPTIONS}
          value={params.status}
          onChange={(event) =>
            setParams({ status: (event.target.value || "") as ExpenseCategory | "" })
          }
        />
        <Select
          label="Sort by"
          options={[
            { value: "expenseDate", label: "Date" },
            { value: "amount", label: "Amount" },
            { value: "createdAt", label: "Recorded" },
          ]}
          value={params.sortBy}
          onChange={(event) => setParams({ sortBy: event.target.value as ExpenseSortField })}
        />
        <Select
          label="Order"
          options={[
            { value: "asc", label: "Ascending" },
            { value: "desc", label: "Descending" },
          ]}
          value={params.sortOrder}
          onChange={(event) =>
            setParams({ sortOrder: event.target.value === "asc" ? "asc" : "desc" })
          }
        />
        <Select
          label="Page size"
          options={pageSizeOptions(params.limit)}
          value={String(params.limit)}
          onChange={(event) => setParams({ limit: Number(event.target.value) })}
        />
        {hasFilters ? (
          <Button variant="secondary" className="col-span-2 md:col-auto" onClick={reset}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {isError ? (
        <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
          {apiErrorMessage(error, "Could not load expenses.")}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
          {actionError}
        </p>
      ) : null}

      <DataTable>
        <table data-testid="expenses-table" className="w-full text-left text-sm">
          <thead className="bg-surface text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Payee</th>
              <th className="px-4 py-3 font-medium">Branch</th>
              <th className="px-4 py-3 font-medium text-right">Amount</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody
            className={`divide-y divide-fg/5 transition-opacity ${
              isFetching && !isPending ? "opacity-60" : ""
            }`}
          >
            {isPending ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-fg-muted">
                  Loading expenses…
                </td>
              </tr>
            ) : expenses.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-fg-muted">
                  {hasFilters ? "No expenses match those filters." : "No expenses yet."}
                </td>
              </tr>
            ) : (
              expenses.map((expense) => (
                <tr
                  key={expense.id}
                  data-testid="expense-row"
                  data-expense-id={expense.id}
                  className="bg-bg hover:bg-accent/10"
                >
                  <td className="px-4 py-3 text-fg/70">{expense.expenseDate}</td>
                  <td className="px-4 py-3 text-fg">
                    {EXPENSE_CATEGORY_LABELS[expense.category]}
                  </td>
                  <td className="px-4 py-3 text-fg/70">{expense.paidTo ?? "—"}</td>
                  <td className="px-4 py-3 text-fg/70">
                    {expense.branch?.name ?? "Org-level"}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-fg">
                    {formatPrice(expense.amount)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => navigate(`/expenses/${expense.id}/edit`)}
                      >
                        Edit
                      </Button>
                      {pendingDelete === expense.id ? (
                        <Button
                          data-testid="confirm-delete-expense"
                          variant="danger"
                          disabled={remove.isPending}
                          onClick={() => void confirmDelete(expense.id)}
                        >
                          Confirm delete
                        </Button>
                      ) : (
                        <Button
                          data-testid="delete-expense"
                          variant="danger"
                          onClick={() => setPendingDelete(expense.id)}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </DataTable>

      {pagination && pagination.totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-fg-muted">
            Page {pagination.page} of {pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={pagination.page <= 1}
              onClick={() => setParams({ page: pagination.page - 1 })}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setParams({ page: pagination.page + 1 })}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
