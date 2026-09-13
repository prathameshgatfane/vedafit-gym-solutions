import { useSessionStore } from "../../stores/session.store";
import { Button } from "../../components/ui/Button";
import { DataTable } from "../../components/ui/DataTable";
import { Select } from "../../components/ui/Select";
import { Spinner } from "../../components/ui/Spinner";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { formatPrice, formatSignedPrice } from "../../lib/money";
import { useUrlListParams, type ListParamsConfig } from "../../lib/url-list-params";
import { EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from "../expenses/expense.types";
import { useProfitLoss } from "../expenses/useExpenses";

const CONFIG: ListParamsConfig<"from", never, "from" | "to" | "branchId"> = {
  sortFields: ["from"],
  statuses: [],
  defaults: {
    page: 1,
    limit: 10,
    search: "",
    status: "",
    sortBy: "from",
    sortOrder: "asc",
  },
  extraKeys: ["from", "to", "branchId"],
};

export function ProfitLossPage() {
  const { extras, setExtras } = useUrlListParams(CONFIG);
  const branches = useSessionStore((s) => s.branches);
  const userBranchId = useSessionStore((s) => s.user?.branchId ?? null);

  const query = {
    from: extras.from || undefined,
    to: extras.to || extras.from || undefined,
    branchId: extras.branchId || undefined,
  };

  const { data, isPending, isError, error } = useProfitLoss(query);

  if (isPending && !data) return <Spinner label="Loading report" />;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 data-testid="pnl-heading" className="text-2xl font-semibold text-brand-white">
          Revenue vs expenses
        </h1>
        <p className="mt-1 text-sm text-brand-green-muted">
          Gym-local months, same window as the dashboard&apos;s revenue widget. Org-level costs
          appear only when you are looking at the whole gym.
        </p>
      </div>

      <div
        data-testid="pnl-filters"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-brand-white/10 bg-brand-black-88 p-4"
      >
        <TextField
          label="From (YYYY-MM)"
          data-testid="pnl-from"
          placeholder={data?.from ?? "Current month"}
          value={extras.from}
          onChange={(event) => setExtras({ from: event.target.value })}
        />
        <TextField
          label="To (YYYY-MM)"
          data-testid="pnl-to"
          placeholder={data?.to ?? "Current month"}
          value={extras.to}
          onChange={(event) => setExtras({ to: event.target.value })}
        />
        {userBranchId ? null : (
          <Select
            label="Branch"
            data-testid="pnl-branch"
            placeholder="All branches"
            options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
            value={extras.branchId}
            onChange={(event) => setExtras({ branchId: event.target.value })}
          />
        )}
        {extras.from || extras.to || extras.branchId ? (
          <Button variant="secondary" onClick={() => setExtras({ from: "", to: "", branchId: "" })}>
            This month, all branches
          </Button>
        ) : null}
      </div>

      {isError ? (
        <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {apiErrorMessage(error, "Could not load this report.")}
        </p>
      ) : null}

      {data ? (
        <>
          <p className="text-sm text-brand-white/50">
            {data.from === data.to ? data.from : `${data.from} → ${data.to}`}
            {data.scope.branchName ? ` · ${data.scope.branchName}` : " · All branches"}
            {` · ${data.timezone}`}
          </p>

          <dl
            data-testid="pnl-totals"
            className="grid gap-4 rounded-lg border border-brand-white/10 bg-brand-black-88 p-6 sm:grid-cols-3"
          >
            <div>
              <dt className="text-xs uppercase tracking-wide text-brand-white/50">Revenue</dt>
              <dd data-testid="pnl-revenue" className="mt-1 text-2xl font-semibold text-brand-white">
                {formatPrice(data.revenue)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-brand-white/50">Expenses</dt>
              <dd data-testid="pnl-expenses" className="mt-1 text-2xl font-semibold text-brand-white">
                {formatPrice(data.expenses)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-brand-white/50">Net</dt>
              <dd data-testid="pnl-net" className="mt-1 text-2xl font-semibold text-brand-green">
                {formatSignedPrice(data.net)}
              </dd>
            </div>
          </dl>

          <section className="rounded-lg border border-brand-white/10 bg-brand-black-88 p-6">
            <h2 className="text-lg font-semibold text-brand-white">By category</h2>
            <div className="mt-4">
            <DataTable fit>
            <table data-testid="pnl-categories" className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-brand-white/50">
                <tr>
                  <th className="py-2 font-medium">Category</th>
                  <th className="py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-white/5">
                {data.byCategory.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="py-6 text-center text-brand-white/50">
                      No expenses in this window.
                    </td>
                  </tr>
                ) : (
                  data.byCategory.map((row) => (
                    <tr key={row.category} data-testid="pnl-category-row">
                      <td className="py-2 text-brand-white">
                        {EXPENSE_CATEGORY_LABELS[row.category as ExpenseCategory] ?? row.category}
                      </td>
                      <td className="py-2 text-right text-brand-white">
                        {formatPrice(row.total)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </DataTable>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
